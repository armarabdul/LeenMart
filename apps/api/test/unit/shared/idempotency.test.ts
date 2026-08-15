import { describe, expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';
import { ConflictError, FixedClock, UuidV7Generator, ValidationError } from '@leen-mart/domain-kit';
import { idempotency } from '../../../src/shared/interface/http/middleware/idempotency.js';
import type { IdempotencyKeyRepository } from '../../../src/shared/infrastructure/persistence/idempotency-key.repository.js';
import { toSessionId } from '../../../src/modules/identity/domain/value-objects/session-id.value-object.js';
import { toUserId } from '../../../src/modules/identity/domain/value-objects/user-id.value-object.js';

const ids = new UuidV7Generator();
const clock = new FixedClock(new Date('2026-03-01T00:00:00.000Z'));
const ENDPOINT = 'POST /api/v1/orders';

const principal = {
  userId: toUserId(ids.generate()),
  sessionId: toSessionId(ids.generate()),
  role: 'CUSTOMER' as const,
};

const fakeRepository = (
  claimResult: Awaited<ReturnType<IdempotencyKeyRepository['claim']>>,
): IdempotencyKeyRepository & {
  complete: ReturnType<typeof vi.fn>;
  release: ReturnType<typeof vi.fn>;
} =>
  ({
    claim: vi.fn().mockResolvedValue(claimResult),
    complete: vi.fn(),
    release: vi.fn(),
  }) as unknown as IdempotencyKeyRepository & {
    complete: ReturnType<typeof vi.fn>;
    release: ReturnType<typeof vi.fn>;
  };

/** A minimal Express-shaped req/res/next trio — only what the middleware actually touches. */
const buildContext = (
  headers: Record<string, string> = {},
): { req: Request; res: Response; next: ReturnType<typeof vi.fn> } => {
  const req = {
    principal,
    header: (name: string) => headers[name.toLowerCase()],
    validated: { body: { addressId: 'x', paymentMethod: 'ONLINE' } },
    body: {},
  } as unknown as Request;

  let capturedStatus = 200;
  const res = {
    status: vi.fn(function (this: unknown, code: number) {
      capturedStatus = code;
      return res;
    }),
    json: vi.fn(),
    on: vi.fn(),
    get statusCode() {
      return capturedStatus;
    },
  } as unknown as Response;

  const next = vi.fn();
  return { req, res, next };
};

describe('idempotency middleware', () => {
  it('rejects with a ValidationError when the header is missing', async () => {
    const repository = fakeRepository('claimed');
    const { req, res, next } = buildContext();

    idempotency(repository, ENDPOINT, { clock, idGenerator: ids })(req, res, next);
    await new Promise((resolve) => setImmediate(resolve));

    expect(next).toHaveBeenCalledWith(expect.any(ValidationError));
    expect(repository.claim).not.toHaveBeenCalled();
  });

  it('claims the key and calls next() on a fresh request', async () => {
    const repository = fakeRepository('claimed');
    const { req, res, next } = buildContext({ 'idempotency-key': 'key-1' });

    idempotency(repository, ENDPOINT, { clock, idGenerator: ids })(req, res, next);
    await new Promise((resolve) => setImmediate(resolve));

    expect(repository.claim).toHaveBeenCalledWith(
      expect.objectContaining({ userId: principal.userId, key: 'key-1', endpoint: ENDPOINT }),
    );
    expect(next).toHaveBeenCalledWith();
  });

  it('rejects with a 409 ConflictError when the key is reused with a different payload', async () => {
    const repository = fakeRepository({
      status: 'COMPLETED',
      requestHash: 'a-different-hash',
      expiresAt: new Date('2026-03-02T00:00:00.000Z'),
      responseStatus: 201,
      responseBody: {},
    });
    const { req, res, next } = buildContext({ 'idempotency-key': 'key-1' });

    idempotency(repository, ENDPOINT, { clock, idGenerator: ids })(req, res, next);
    await new Promise((resolve) => setImmediate(resolve));

    const error = next.mock.calls[0]?.[0] as ConflictError;
    expect(error).toBeInstanceOf(ConflictError);
    expect(error.code).toBe('IDEMPOTENCY_KEY_REUSED');
  });

  it('rejects with a 409 ConflictError when a request with the same key is still IN_PROGRESS', async () => {
    // The middleware hashes req.validated.body — matching hash here, differing status.
    const bodyHash = await import('node:crypto').then(({ createHash }) =>
      createHash('sha256')
        .update(JSON.stringify({ addressId: 'x', paymentMethod: 'ONLINE' }))
        .digest('hex'),
    );
    const repository = fakeRepository({
      status: 'IN_PROGRESS',
      requestHash: bodyHash,
      expiresAt: new Date('2026-03-02T00:00:00.000Z'),
      responseStatus: null,
      responseBody: null,
    });
    const { req, res, next } = buildContext({ 'idempotency-key': 'key-1' });

    idempotency(repository, ENDPOINT, { clock, idGenerator: ids })(req, res, next);
    await new Promise((resolve) => setImmediate(resolve));

    const error = next.mock.calls[0]?.[0] as ConflictError;
    expect(error).toBeInstanceOf(ConflictError);
    expect(error.code).toBe('IDEMPOTENCY_KEY_IN_PROGRESS');
  });

  it('replays the original response verbatim for a matching, COMPLETED key', async () => {
    const bodyHash = await import('node:crypto').then(({ createHash }) =>
      createHash('sha256')
        .update(JSON.stringify({ addressId: 'x', paymentMethod: 'ONLINE' }))
        .digest('hex'),
    );
    const storedBody = { data: { id: 'order-1' } };
    const repository = fakeRepository({
      status: 'COMPLETED',
      requestHash: bodyHash,
      expiresAt: new Date('2026-03-02T00:00:00.000Z'),
      responseStatus: 201,
      responseBody: storedBody,
    });
    const { req, res, next } = buildContext({ 'idempotency-key': 'key-1' });

    idempotency(repository, ENDPOINT, { clock, idGenerator: ids })(req, res, next);
    await new Promise((resolve) => setImmediate(resolve));

    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith(storedBody);
    expect(next).not.toHaveBeenCalled();
  });
});
