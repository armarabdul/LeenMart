import { describe, expect, it, vi } from 'vitest';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { UnauthenticatedError } from '@leen-mart/domain-kit';
import {
  authenticate,
  optionalAuthenticate,
} from '../../src/shared/interface/http/middleware/authenticate.js';
import type {
  AccessTokenClaims,
  AccessTokenService,
  SignedAccessToken,
} from '../../src/modules/identity/application/ports/access-token.port.js';
import type { SessionDenylist } from '../../src/modules/identity/application/ports/session-denylist.port.js';
import { toUserId } from '../../src/modules/identity/domain/value-objects/user-id.value-object.js';
import {
  toSessionId,
  type SessionId,
} from '../../src/modules/identity/domain/value-objects/session-id.value-object.js';

class FakeAccessTokenService implements AccessTokenService {
  constructor(readonly verify: (token: string) => AccessTokenClaims) {}

  sign(): SignedAccessToken {
    throw new Error('Not used by these tests.');
  }
}

/** Denies exactly the session ids it was seeded with; everything else is live. */
class FakeSessionDenylist implements SessionDenylist {
  private readonly denied: Set<string>;

  constructor(denied: readonly SessionId[] = []) {
    this.denied = new Set(denied);
  }

  deny(sessionId: SessionId): Promise<void> {
    this.denied.add(sessionId);
    return Promise.resolve();
  }

  isDenied(sessionId: SessionId): Promise<boolean> {
    return Promise.resolve(this.denied.has(sessionId));
  }
}

const userId = toUserId('00000000-0000-7000-8000-000000000042');
const sessionId = toSessionId('00000000-0000-7000-8000-000000000043');
const otherSessionId = toSessionId('00000000-0000-7000-8000-000000000044');

const claimsFor = (overrides: Partial<AccessTokenClaims> = {}): AccessTokenClaims => ({
  sub: userId,
  sid: sessionId,
  jti: 'a-token-id',
  role: 'CUSTOMER',
  ...overrides,
});

/**
 * The middleware is now asynchronous (the denylist lookup is I/O), so this
 * awaits `next` being called rather than reading the result synchronously.
 */
/** Defaults to `authenticate` — every pre-existing call site below exercises that middleware unless it names `optionalAuthenticate` explicitly. */
const run = async (
  service: AccessTokenService,
  headers: Record<string, string> = {},
  denylist: SessionDenylist = new FakeSessionDenylist(),
  middleware: (
    service: AccessTokenService,
    denylist: SessionDenylist,
  ) => RequestHandler = authenticate,
): Promise<{ req: Request; error: unknown; nextCalledWithNoError: boolean }> => {
  const req = {
    header: (name: string) => headers[name.toLowerCase()],
  } as unknown as Request;

  let error: unknown;
  let nextCalledWithNoError = false;
  let settle: () => void = () => undefined;
  const called = new Promise<void>((resolve) => {
    settle = resolve;
  });

  const next = vi.fn((err?: unknown) => {
    if (err === undefined) {
      nextCalledWithNoError = true;
    } else {
      error = err;
    }
    settle();
  }) as unknown as NextFunction;

  middleware(service, denylist)(req, {} as Response, next);
  await called;

  return { req, error, nextCalledWithNoError };
};

describe('authenticate middleware', () => {
  it('valid Bearer token on a live session: attaches a Principal and calls next() with no error', async () => {
    const service = new FakeAccessTokenService(() => claimsFor());

    const { req, error, nextCalledWithNoError } = await run(service, {
      authorization: 'Bearer valid-token',
    });

    expect(error).toBeUndefined();
    expect(nextCalledWithNoError).toBe(true);
    expect(req.principal).toEqual({ userId, sessionId, role: 'CUSTOMER' });
  });

  it('missing Authorization header: rejects with UnauthenticatedError, no principal attached', async () => {
    const service = new FakeAccessTokenService(() => claimsFor());

    const { req, error } = await run(service, {});

    expect(error).toBeInstanceOf(UnauthenticatedError);
    expect((error as UnauthenticatedError).code).toBe('INVALID_ACCESS_TOKEN');
    expect(req.principal).toBeUndefined();
  });

  it('malformed Authorization header (no recognisable scheme): rejects', async () => {
    const service = new FakeAccessTokenService(() => claimsFor());

    const { error } = await run(service, { authorization: 'garbage-not-a-scheme' });

    expect(error).toBeInstanceOf(UnauthenticatedError);
  });

  it('non-Bearer scheme (e.g. Basic): rejects', async () => {
    const service = new FakeAccessTokenService(() => claimsFor());

    const { error } = await run(service, { authorization: 'Basic dXNlcjpwYXNz' });

    expect(error).toBeInstanceOf(UnauthenticatedError);
  });

  it('Bearer scheme with an empty token: rejects without ever calling verify()', async () => {
    const verifySpy = vi.fn<(token: string) => AccessTokenClaims>();
    const service = new FakeAccessTokenService(verifySpy);

    const { error } = await run(service, { authorization: 'Bearer ' });

    expect(error).toBeInstanceOf(UnauthenticatedError);
    expect(verifySpy).not.toHaveBeenCalled();
  });

  it('invalid token: forwards the exact error AccessTokenService.verify() throws', async () => {
    const service = new FakeAccessTokenService(() => {
      throw new UnauthenticatedError('Invalid or expired access token.', {
        code: 'INVALID_ACCESS_TOKEN',
      });
    });

    const { error } = await run(service, { authorization: 'Bearer not-a-real-token' });

    expect(error).toBeInstanceOf(UnauthenticatedError);
    expect((error as UnauthenticatedError).code).toBe('INVALID_ACCESS_TOKEN');
  });

  it('expired token: rejects with the same uniform error as any other invalid token', async () => {
    const service = new FakeAccessTokenService(() => {
      throw new UnauthenticatedError('Invalid or expired access token.', {
        code: 'INVALID_ACCESS_TOKEN',
      });
    });

    const { error } = await run(service, { authorization: 'Bearer expired-token' });

    expect(error).toBeInstanceOf(UnauthenticatedError);
    expect((error as UnauthenticatedError).code).toBe('INVALID_ACCESS_TOKEN');
  });

  it('preserves the verified role exactly', async () => {
    const service = new FakeAccessTokenService(() => claimsFor({ role: 'SUPER_ADMIN' }));

    const { req } = await run(service, { authorization: 'Bearer token' });

    expect(req.principal?.role).toBe('SUPER_ADMIN');
  });

  it('preserves the verified user id exactly', async () => {
    const service = new FakeAccessTokenService(() => claimsFor());

    const { req } = await run(service, { authorization: 'Bearer token' });

    expect(req.principal?.userId).toBe(userId);
  });

  it('carries the verified session id onto the Principal', async () => {
    const service = new FakeAccessTokenService(() => claimsFor());

    const { req } = await run(service, { authorization: 'Bearer token' });

    expect(req.principal?.sessionId).toBe(sessionId);
  });

  describe('session denylist (SDD 7.2)', () => {
    it('rejects a signature-valid token whose session has been denied', async () => {
      // The whole point: the token itself is still perfectly valid — only the
      // session behind it died.
      const service = new FakeAccessTokenService(() => claimsFor());

      const { req, error } = await run(
        service,
        { authorization: 'Bearer still-well-signed' },
        new FakeSessionDenylist([sessionId]),
      );

      expect(error).toBeInstanceOf(UnauthenticatedError);
      expect(req.principal).toBeUndefined();
    });

    it('answers a denied session with the same uniform error as an invalid token (SEC-15)', async () => {
      const service = new FakeAccessTokenService(() => claimsFor());

      const denied = await run(
        service,
        { authorization: 'Bearer valid' },
        new FakeSessionDenylist([sessionId]),
      );
      const missingHeader = await run(service, {});

      expect((denied.error as UnauthenticatedError).code).toBe('INVALID_ACCESS_TOKEN');
      expect((denied.error as UnauthenticatedError).message).toBe(
        (missingHeader.error as UnauthenticatedError).message,
      );
    });

    it('leaves a different session unaffected by another session being denied', async () => {
      const service = new FakeAccessTokenService(() => claimsFor({ sid: otherSessionId }));

      const { req, error } = await run(
        service,
        { authorization: 'Bearer valid' },
        new FakeSessionDenylist([sessionId]),
      );

      expect(error).toBeUndefined();
      expect(req.principal?.sessionId).toBe(otherSessionId);
    });

    it('does not consult the denylist when the token itself is invalid', async () => {
      // Ordering matters for cost, not just correctness: an unauthenticated
      // flood must not turn into a Redis round trip per request.
      const isDenied = vi.fn<(sessionId: SessionId) => Promise<boolean>>();
      const denylist = { deny: () => Promise.resolve(), isDenied } as SessionDenylist;
      const service = new FakeAccessTokenService(() => {
        throw new UnauthenticatedError('Invalid or expired access token.', {
          code: 'INVALID_ACCESS_TOKEN',
        });
      });

      await run(service, { authorization: 'Bearer nope' }, denylist);

      expect(isDenied).not.toHaveBeenCalled();
    });

    it('fails closed if the denylist lookup itself throws', async () => {
      // A Redis outage must not silently admit revoked sessions.
      const service = new FakeAccessTokenService(() => claimsFor());
      const denylist = {
        deny: () => Promise.resolve(),
        isDenied: () => Promise.reject(new Error('redis is down')),
      } as SessionDenylist;

      const { req, error } = await run(service, { authorization: 'Bearer valid' }, denylist);

      expect(error).toBeInstanceOf(Error);
      expect(req.principal).toBeUndefined();
    });
  });
});

/**
 * S2-7's "auth optional" variant. Every case here mirrors an `authenticate`
 * case above with one deliberate difference: no header is anonymous, never a
 * rejection — everything else (a header naming a malformed/expired/denied
 * credential) still 401s exactly like `authenticate` does, which is the
 * behaviour the S2-7 final approval's correction 1 requires and this suite
 * exists to pin down.
 */
describe('optionalAuthenticate middleware', () => {
  it('missing Authorization header: proceeds anonymously, no principal, no error', async () => {
    const service = new FakeAccessTokenService(() => claimsFor());

    const { req, error, nextCalledWithNoError } = await run(
      service,
      {},
      new FakeSessionDenylist(),
      optionalAuthenticate,
    );

    expect(error).toBeUndefined();
    expect(nextCalledWithNoError).toBe(true);
    expect(req.principal).toBeUndefined();
  });

  it('valid Bearer token on a live session: attaches a Principal, same as authenticate', async () => {
    const service = new FakeAccessTokenService(() => claimsFor());

    const { req, error, nextCalledWithNoError } = await run(
      service,
      { authorization: 'Bearer valid-token' },
      new FakeSessionDenylist(),
      optionalAuthenticate,
    );

    expect(error).toBeUndefined();
    expect(nextCalledWithNoError).toBe(true);
    expect(req.principal).toEqual({ userId, sessionId, role: 'CUSTOMER' });
  });

  it('present but malformed Authorization header (no recognisable scheme): 401, not anonymous', async () => {
    const service = new FakeAccessTokenService(() => claimsFor());

    const { error } = await run(
      service,
      { authorization: 'garbage-not-a-scheme' },
      new FakeSessionDenylist(),
      optionalAuthenticate,
    );

    expect(error).toBeInstanceOf(UnauthenticatedError);
    expect((error as UnauthenticatedError).code).toBe('INVALID_ACCESS_TOKEN');
  });

  it('Bearer scheme with an empty token: 401, not anonymous, and verify() is never called', async () => {
    const verifySpy = vi.fn<(token: string) => AccessTokenClaims>();
    const service = new FakeAccessTokenService(verifySpy);

    const { error } = await run(
      service,
      { authorization: 'Bearer ' },
      new FakeSessionDenylist(),
      optionalAuthenticate,
    );

    expect(error).toBeInstanceOf(UnauthenticatedError);
    expect(verifySpy).not.toHaveBeenCalled();
  });

  it('present but invalid (rejected by verify()) token: 401, never silently downgraded to anonymous', async () => {
    const service = new FakeAccessTokenService(() => {
      throw new UnauthenticatedError('Invalid or expired access token.', {
        code: 'INVALID_ACCESS_TOKEN',
      });
    });

    const { req, error } = await run(
      service,
      { authorization: 'Bearer not-a-real-token' },
      new FakeSessionDenylist(),
      optionalAuthenticate,
    );

    expect(error).toBeInstanceOf(UnauthenticatedError);
    expect((error as UnauthenticatedError).code).toBe('INVALID_ACCESS_TOKEN');
    expect(req.principal).toBeUndefined();
  });

  it('present but expired token: 401, never silently downgraded to anonymous', async () => {
    const service = new FakeAccessTokenService(() => {
      throw new UnauthenticatedError('Invalid or expired access token.', {
        code: 'INVALID_ACCESS_TOKEN',
      });
    });

    const { req, error } = await run(
      service,
      { authorization: 'Bearer expired-token' },
      new FakeSessionDenylist(),
      optionalAuthenticate,
    );

    expect(error).toBeInstanceOf(UnauthenticatedError);
    expect((error as UnauthenticatedError).code).toBe('INVALID_ACCESS_TOKEN');
    expect(req.principal).toBeUndefined();
  });

  it('present token on a denied session: 401, never silently downgraded to anonymous', async () => {
    const service = new FakeAccessTokenService(() => claimsFor());

    const { req, error } = await run(
      service,
      { authorization: 'Bearer still-well-signed' },
      new FakeSessionDenylist([sessionId]),
      optionalAuthenticate,
    );

    expect(error).toBeInstanceOf(UnauthenticatedError);
    expect((error as UnauthenticatedError).code).toBe('INVALID_ACCESS_TOKEN');
    expect(req.principal).toBeUndefined();
  });

  it('a denied credential and a missing one are still distinguishable outcomes here (anonymous succeeds, denied 401s)', async () => {
    const service = new FakeAccessTokenService(() => claimsFor());

    const denied = await run(
      service,
      { authorization: 'Bearer valid' },
      new FakeSessionDenylist([sessionId]),
      optionalAuthenticate,
    );
    const missingHeader = await run(service, {}, new FakeSessionDenylist(), optionalAuthenticate);

    expect(denied.error).toBeInstanceOf(UnauthenticatedError);
    expect(missingHeader.error).toBeUndefined();
    expect(missingHeader.nextCalledWithNoError).toBe(true);
  });
});
