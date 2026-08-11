import { describe, expect, it, vi } from 'vitest';
import express, { type NextFunction, type Request, type Response } from 'express';
import request from 'supertest';
import { UuidV7Generator } from '@leen-mart/domain-kit';
import {
  getRequestContext,
  getRequestId,
  requestContextMiddleware,
} from '../../src/shared/interface/http/middleware/request-context.js';

interface RunOptions {
  readonly headers?: Record<string, string>;
  /** What Express resolved as the client IP under `trust proxy`. */
  readonly ip?: string | undefined;
}

/**
 * Runs the middleware and captures the context that was ambient inside it —
 * which is the only place it exists, since `AsyncLocalStorage` unwinds as soon
 * as `next()` returns.
 */
const run = (
  options: RunOptions = {},
): {
  context: ReturnType<typeof getRequestContext>;
  requestId: string;
  setHeader: ReturnType<typeof vi.fn>;
} => {
  const headers = options.headers ?? {};
  const req = {
    header: (name: string) => headers[name.toLowerCase()],
    ip: options.ip,
  } as unknown as Request;

  const setHeader = vi.fn();
  const res = { setHeader } as unknown as Response;

  let context: ReturnType<typeof getRequestContext>;
  let requestId = '';
  const next = vi.fn(() => {
    context = getRequestContext();
    requestId = getRequestId();
  }) as unknown as NextFunction;

  requestContextMiddleware(new UuidV7Generator())(req, res, next);

  return { context, requestId, setHeader };
};

describe('requestContextMiddleware', () => {
  describe('requestId (SDD 9.2) — unchanged behaviour', () => {
    it('generates a correlation id when the client sends none', () => {
      const { context, requestId } = run();

      expect(context?.requestId).toEqual(expect.any(String) as unknown as string);
      expect(requestId).toBe(context?.requestId);
    });

    it('adopts a client-supplied x-request-id', () => {
      const { context } = run({ headers: { 'x-request-id': 'client-correlation-id' } });

      expect(context?.requestId).toBe('client-correlation-id');
    });

    it('rejects an over-long x-request-id and generates its own instead', () => {
      const { context } = run({ headers: { 'x-request-id': 'x'.repeat(129) } });

      expect(context?.requestId).not.toBe('x'.repeat(129));
    });

    it('echoes the correlation id back on the response', () => {
      const { context, setHeader } = run();

      expect(setHeader).toHaveBeenCalledWith('x-request-id', context?.requestId);
    });

    it('still exposes startedAt', () => {
      const { context } = run();

      expect(context?.startedAt).toEqual(expect.any(Number) as unknown as number);
    });

    it('answers with the sentinel outside any request', () => {
      expect(getRequestId()).toBe('no-request-context');
      expect(getRequestContext()).toBeUndefined();
    });
  });

  describe('ip (SDD 18.4)', () => {
    it('captures the address Express resolved', () => {
      const { context } = run({ ip: '203.0.113.7' });

      expect(context?.ip).toBe('203.0.113.7');
    });

    it('is null when Express resolved no address', () => {
      const { context } = run({ ip: undefined });

      expect(context?.ip).toBeNull();
    });

    it('never reads X-Forwarded-For itself, so a client cannot spoof its address', () => {
      // `app.ts` sets `trust proxy` to a hop *count* precisely so the resolved
      // `req.ip` cannot be forged. Reading the header here would step around
      // that; this asserts the middleware does not.
      const { context } = run({
        ip: '203.0.113.7',
        headers: { 'x-forwarded-for': '198.51.100.99, 10.0.0.1' },
      });

      expect(context?.ip).toBe('203.0.113.7');
      expect(context?.ip).not.toContain('198.51.100.99');
    });

    it('ignores an X-Real-IP header too', () => {
      const { context } = run({ ip: '203.0.113.7', headers: { 'x-real-ip': '198.51.100.99' } });

      expect(context?.ip).toBe('203.0.113.7');
    });
  });

  describe('userAgent (SDD 18.4)', () => {
    it('captures the User-Agent header', () => {
      const { context } = run({ headers: { 'user-agent': 'Mozilla/5.0 (probe)' } });

      expect(context?.userAgent).toBe('Mozilla/5.0 (probe)');
    });

    it('is null when the header is absent', () => {
      // Matches `AuditLogRequestContext`, which models all three transport
      // facts as nullable.
      const { context } = run();

      expect(context?.userAgent).toBeNull();
    });

    it('is null when the header is present but empty', () => {
      const { context } = run({ headers: { 'user-agent': '' } });

      expect(context?.userAgent).toBeNull();
    });

    it('truncates an over-long User-Agent rather than carrying it whole', () => {
      // Entirely client-controlled, and Node allows kilobytes of headers.
      const { context } = run({ headers: { 'user-agent': 'A'.repeat(5000) } });

      expect(context?.userAgent).toHaveLength(512);
    });

    it('leaves a realistic User-Agent untouched', () => {
      const realistic =
        'Mozilla/5.0 (Linux; Android 13; SM-G991B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36';
      const { context } = run({ headers: { 'user-agent': realistic } });

      expect(context?.userAgent).toBe(realistic);
    });
  });

  describe('the whole context', () => {
    it('carries every field SDD 18.4 needs from the transport', () => {
      const { context } = run({
        ip: '203.0.113.7',
        headers: { 'user-agent': 'probe/1.0', 'x-request-id': 'corr-1' },
      });

      expect(context).toEqual({
        requestId: 'corr-1',
        ip: '203.0.113.7',
        userAgent: 'probe/1.0',
        startedAt: expect.any(Number) as unknown as number,
      });
    });
  });
});

/**
 * The pure-middleware tests above drive `req` directly. These drive a real
 * Express app instead, because `req.ip` is not a plain property — it is
 * derived by Express from the socket address and the `trust proxy` setting,
 * and that derivation is the whole reason this middleware reads `req.ip`
 * rather than a header. Mocking it would test the mock.
 *
 * No database or Redis: this exercises the HTTP layer alone, so it belongs to
 * the fast unit project.
 */
describe('requestContextMiddleware under real Express', () => {
  /** Mirrors `app.ts`: a hop *count*, never `true`. */
  const buildApp = (trustProxy: number | boolean): express.Express => {
    const app = express();
    app.set('trust proxy', trustProxy);
    app.use(requestContextMiddleware(new UuidV7Generator()));
    // A probe, not a production route: the context is only observable from
    // inside the request, and nothing in the application reads it yet.
    app.get('/probe', (_req, res) => {
      res.json(getRequestContext() ?? {});
    });
    return app;
  };

  interface ProbeBody {
    requestId: string;
    ip: string | null;
    userAgent: string | null;
    startedAt: number;
  }

  it('captures the socket address when no proxy header is sent', async () => {
    const response = await request(buildApp(1)).get('/probe').expect(200);

    // Supertest connects over loopback.
    expect((response.body as ProbeBody).ip).toEqual(expect.any(String) as unknown as string);
  });

  it('honours one proxy hop, taking the client address from X-Forwarded-For', async () => {
    const response = await request(buildApp(1))
      .get('/probe')
      .set('X-Forwarded-For', '203.0.113.7')
      .expect(200);

    expect((response.body as ProbeBody).ip).toBe('203.0.113.7');
  });

  it('does not let a client past the configured hop count spoof its address', async () => {
    // Two forwarded addresses but only one trusted hop: Express takes the
    // right-most trusted entry, so the left-most (attacker-chosen) value must
    // not win. This is what `trust proxy: <count>` buys over `true`.
    const response = await request(buildApp(1))
      .get('/probe')
      .set('X-Forwarded-For', '198.51.100.99, 203.0.113.7')
      .expect(200);

    expect((response.body as ProbeBody).ip).not.toBe('198.51.100.99');
    expect((response.body as ProbeBody).ip).toBe('203.0.113.7');
  });

  it('captures the real User-Agent header', async () => {
    const response = await request(buildApp(1))
      .get('/probe')
      .set('User-Agent', 'leen-mart-test/1.0')
      .expect(200);

    expect((response.body as ProbeBody).userAgent).toBe('leen-mart-test/1.0');
  });

  it('still echoes the correlation id on the response', async () => {
    const response = await request(buildApp(1)).get('/probe').expect(200);

    expect(response.headers['x-request-id']).toBe((response.body as ProbeBody).requestId);
  });
});
