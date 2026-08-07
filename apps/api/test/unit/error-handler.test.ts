import { describe, expect, it, vi } from 'vitest';
import type { NextFunction, Request, Response } from 'express';
import { ZodError, z } from 'zod';
import {
  ConflictError,
  FixedClock,
  ForbiddenError,
  IntegrationError,
  NotFoundError,
  RateLimitError,
  ValidationError,
} from '@leen-mart/domain-kit';
import { createErrorHandler, STATUS_BY_KIND } from '../../src/shared/interface/http/middleware/error-handler.js';

const clock = new FixedClock(new Date('2026-01-01T00:00:00.000Z'));

const createLogger = (): Record<string, ReturnType<typeof vi.fn>> => ({
  fatal: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
  debug: vi.fn(),
  trace: vi.fn(),
});

interface MockResponse {
  headersSent: boolean;
  statusCode: number;
  body: unknown;
  headers: Record<string, string>;
  status: (code: number) => MockResponse;
  json: (payload: unknown) => MockResponse;
  setHeader: (name: string, value: string) => void;
}

const createResponse = (): MockResponse => {
  const res: MockResponse = {
    headersSent: false,
    statusCode: 200,
    body: undefined,
    headers: {},
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
    setHeader(name, value) {
      this.headers[name] = value;
    },
  };
  return res;
};

const handle = (
  error: unknown,
): { res: MockResponse; logger: Record<string, ReturnType<typeof vi.fn>> } => {
  const logger = createLogger();
  const res = createResponse();
  const handler = createErrorHandler(logger as never, clock);
  handler(error, {} as Request, res as unknown as Response, vi.fn() as unknown as NextFunction);
  return { res, logger };
};

describe('global error handler', () => {
  it('maps every error kind to a status code exhaustively', () => {
    expect(STATUS_BY_KIND).toEqual({
      VALIDATION: 400,
      UNAUTHENTICATED: 401,
      FORBIDDEN: 403,
      NOT_FOUND: 404,
      CONFLICT: 409,
      DOMAIN_RULE: 422,
      RATE_LIMIT: 429,
      INTEGRATION: 502,
      INTERNAL: 500,
    });
  });

  it('returns 404 with a stable code for a not-found error', () => {
    const { res } = handle(new NotFoundError());
    expect(res.statusCode).toBe(404);
    expect(res.body).toMatchObject({ error: { code: 'NOT_FOUND' } });
  });

  it('returns 409 and preserves a custom domain code', () => {
    const { res } = handle(new ConflictError('sold out', { code: 'PREORDER_SOLD_OUT' }));
    expect(res.statusCode).toBe(409);
    expect(res.body).toMatchObject({ error: { code: 'PREORDER_SOLD_OUT' } });
  });

  it('converts a raw ZodError into a 400 with field-level detail', () => {
    const schema = z.object({ phone: z.string().min(5) });
    const parsed = schema.safeParse({ phone: '1' });
    const zodError = parsed.success ? new ZodError([]) : parsed.error;

    const { res } = handle(zodError);
    expect(res.statusCode).toBe(400);
    expect(res.body).toMatchObject({ error: { code: 'VALIDATION_FAILED' } });
  });

  it('surfaces validation detail supplied by the domain', () => {
    const { res } = handle(
      new ValidationError('bad', { details: [{ field: 'body.phone', issue: 'required' }] }),
    );
    expect(res.body).toMatchObject({
      error: { details: [{ field: 'body.phone', issue: 'required' }] },
    });
  });

  it('sets Retry-After on a rate-limit error', () => {
    const { res } = handle(new RateLimitError(30));
    expect(res.statusCode).toBe(429);
    expect(res.headers['Retry-After']).toBe('30');
  });

  it('logs an authorization failure at warn, because a burst of them is a signal', () => {
    const { logger } = handle(new ForbiddenError());
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('logs an integration failure at error and hides the provider detail', () => {
    const { res, logger } = handle(
      new IntegrationError('razorpay', 'Payment gateway unavailable', {
        cause: new Error('ECONNRESET at 10.0.3.14:443'),
      }),
    );
    expect(res.statusCode).toBe(502);
    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(res.body)).not.toContain('ECONNRESET');
    expect(JSON.stringify(res.body)).not.toContain('10.0.3.14');
  });

  it('never leaks internals from an unexpected error', () => {
    const { res, logger } = handle(new Error('column "secret_key" does not exist'));
    expect(res.statusCode).toBe(500);
    expect(res.body).toMatchObject({ error: { code: 'INTERNAL_ERROR' } });
    expect(JSON.stringify(res.body)).not.toContain('secret_key');
    expect(logger.error).toHaveBeenCalledTimes(1);
  });

  it('always includes a request id and timestamp for correlation', () => {
    const { res } = handle(new NotFoundError());
    expect(res.body).toMatchObject({
      error: { requestId: expect.any(String) as unknown as string },
    });
  });

  it('delegates to Express when the response has already started', () => {
    const logger = createLogger();
    const res = createResponse();
    res.headersSent = true;
    const next = vi.fn();
    createErrorHandler(logger as never, clock)(
      new NotFoundError(),
      {} as Request,
      res as unknown as Response,
      next as unknown as NextFunction,
    );
    expect(next).toHaveBeenCalledOnce();
    expect(res.body).toBeUndefined();
  });
});
