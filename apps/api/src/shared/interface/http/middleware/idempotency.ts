import { createHash } from 'node:crypto';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import {
  ConflictError,
  ValidationError,
  type Clock,
  type IdGenerator,
} from '@leen-mart/domain-kit';
import type {
  IdempotencyKeyRepository,
  IdempotencyRecord,
} from '../../../infrastructure/persistence/idempotency-key.repository.js';

const HEADER = 'idempotency-key';
/** SDD 9.2/10.5: "honoured for 24 h." */
const TTL_MS = 24 * 60 * 60 * 1000;
const MAX_KEY_LENGTH = 255;

const hashBody = (body: unknown): string =>
  createHash('sha256')
    .update(JSON.stringify(body ?? null))
    .digest('hex');

/**
 * `Idempotency-Key` middleware (SDD 9.2/9.4/10.5/17.1), generic across any
 * money-moving POST — order placement is its first caller, but nothing here
 * names an order.
 *
 * Mount after `authenticate()` (a key is scoped per caller) and after
 * `validate()` (the hash covers the *parsed* body, so a client cannot dodge
 * the mismatch check with whitespace or key-order noise the schema already
 * normalises away).
 *
 * Reusing the same key with the same payload replays the original response
 * (`responseStatus`/`responseBody`, whatever they were — success or error);
 * a different payload is `409 IDEMPOTENCY_KEY_REUSED`; a key still
 * `IN_PROGRESS` (a second, concurrent request) is `409
 * IDEMPOTENCY_KEY_IN_PROGRESS` rather than double-executing the handler.
 *
 * Captures the response by wrapping `res.json` — every controller in this
 * codebase answers through it, including the global error handler, so this
 * one hook sees both a success and a thrown-error outcome without the
 * middleware needing to distinguish them itself. Persistence happens on
 * `res.on('finish')`: only once the response has actually been sent, and
 * only a 2xx is cached for replay — a failure is released so the same key
 * can be retried once the underlying problem (e.g. insufficient stock) is
 * gone.
 */
/** Validates the header, returning the trimmed key or the exact `ValidationError` to forward — never throws itself. */
const extractKey = (req: Request): string | ValidationError => {
  const rawKey = req.header(HEADER);
  if (!rawKey || rawKey.trim().length === 0) {
    return new ValidationError('The Idempotency-Key header is required for this request.', {
      code: 'IDEMPOTENCY_KEY_REQUIRED',
      details: [{ field: 'headers.idempotency-key', issue: 'Required' }],
    });
  }
  if (rawKey.length > MAX_KEY_LENGTH) {
    return new ValidationError('The Idempotency-Key header is too long.', {
      code: 'IDEMPOTENCY_KEY_TOO_LONG',
      details: [
        { field: 'headers.idempotency-key', issue: `Must be at most ${MAX_KEY_LENGTH} characters` },
      ],
    });
  }
  return rawKey.trim();
};

interface ClaimOutcomeContext {
  readonly res: Response;
  readonly next: NextFunction;
  readonly repository: IdempotencyKeyRepository;
  readonly scope: { readonly userId: string; readonly key: string; readonly endpoint: string };
  readonly requestHash: string;
}

/** Split out of `idempotency()`'s returned handler purely to stay under this file's max-lines-per-function budget. */
const handleClaimOutcome = (
  outcome: 'claimed' | IdempotencyRecord,
  ctx: ClaimOutcomeContext,
): void => {
  const { res, next, repository, scope, requestHash } = ctx;

  if (outcome === 'claimed') {
    attachResponseCapture(res, repository, scope);
    next();
    return;
  }

  if (outcome.requestHash !== requestHash) {
    throw new ConflictError('This Idempotency-Key was already used with a different request.', {
      code: 'IDEMPOTENCY_KEY_REUSED',
    });
  }

  if (outcome.status === 'IN_PROGRESS') {
    throw new ConflictError('A request with this Idempotency-Key is already being processed.', {
      code: 'IDEMPOTENCY_KEY_IN_PROGRESS',
    });
  }

  // COMPLETED with a matching hash: replay verbatim (SDD 17.1).
  res.status(outcome.responseStatus ?? 200).json(outcome.responseBody);
};

export const idempotency = (
  repository: IdempotencyKeyRepository,
  endpoint: string,
  deps: { readonly clock: Clock; readonly idGenerator: IdGenerator },
): RequestHandler => {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.principal) {
      next(new Error(`${endpoint}: idempotency() reached without authenticate() middleware.`));
      return;
    }
    const userId = req.principal.userId;

    const key = extractKey(req);
    if (key instanceof ValidationError) {
      next(key);
      return;
    }

    const requestHash = hashBody(req.validated?.body ?? req.body);
    const now = deps.clock.now();
    const scope = { userId, key, endpoint };

    void repository
      .claim({
        id: deps.idGenerator.generate(),
        userId,
        key,
        endpoint,
        requestHash,
        now,
        ttlMs: TTL_MS,
      })
      .then((outcome) => handleClaimOutcome(outcome, { res, next, repository, scope, requestHash }))
      .catch(next);
  };
};

/**
 * Wraps `res.json` to capture the body about to be sent, then persists the
 * outcome once the response has actually flushed. Scoped to this one
 * request/response pair — a fresh wrapper is installed per call, never
 * shared, so there is nothing to reset between requests.
 */
const attachResponseCapture = (
  res: Response,
  repository: IdempotencyKeyRepository,
  scope: { readonly userId: string; readonly key: string; readonly endpoint: string },
): void => {
  let capturedBody: unknown;
  const originalJson = res.json.bind(res);

  res.json = ((body: unknown) => {
    capturedBody = body;
    return originalJson(body);
  }) as Response['json'];

  res.on('finish', () => {
    void (async (): Promise<void> => {
      if (res.statusCode >= 200 && res.statusCode < 300) {
        await repository.complete({
          ...scope,
          responseStatus: res.statusCode,
          responseBody: capturedBody,
        });
      } else {
        await repository.release(scope);
      }
    })().catch(() => {
      // A failure to persist the outcome must not surface to the client —
      // the response already went out. The claim's 24h expiry is the
      // backstop: a stuck IN_PROGRESS row (if `release` itself failed)
      // ages out on its own rather than wedging the key forever.
    });
  });
};
