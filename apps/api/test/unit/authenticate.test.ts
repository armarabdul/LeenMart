import { describe, expect, it, vi } from 'vitest';
import type { NextFunction, Request, Response } from 'express';
import { UnauthenticatedError } from '@leen-mart/domain-kit';
import { authenticate } from '../../src/shared/interface/http/middleware/authenticate.js';
import type {
  AccessTokenClaims,
  AccessTokenService,
  SignedAccessToken,
} from '../../src/modules/identity/application/ports/access-token.port.js';
import { toUserId } from '../../src/modules/identity/domain/value-objects/user-id.value-object.js';

class FakeAccessTokenService implements AccessTokenService {
  constructor(readonly verify: (token: string) => AccessTokenClaims) {}

  sign(): SignedAccessToken {
    throw new Error('Not used by these tests.');
  }
}

const userId = toUserId('00000000-0000-7000-8000-000000000042');

const run = (
  service: AccessTokenService,
  headers: Record<string, string> = {},
): { req: Request; error: unknown; nextCalledWithNoError: boolean } => {
  const req = {
    header: (name: string) => headers[name.toLowerCase()],
  } as unknown as Request;

  let error: unknown;
  let nextCalledWithNoError = false;
  const next = vi.fn((err?: unknown) => {
    if (err === undefined) {
      nextCalledWithNoError = true;
    } else {
      error = err;
    }
  }) as unknown as NextFunction;

  authenticate(service)(req, {} as Response, next);

  return { req, error, nextCalledWithNoError };
};

describe('authenticate middleware', () => {
  it('valid Bearer token: attaches a Principal and calls next() with no error', () => {
    const service = new FakeAccessTokenService(() => ({ sub: userId, role: 'CUSTOMER' }));

    const { req, error, nextCalledWithNoError } = run(service, {
      authorization: 'Bearer valid-token',
    });

    expect(error).toBeUndefined();
    expect(nextCalledWithNoError).toBe(true);
    expect(req.principal).toEqual({ userId, role: 'CUSTOMER' });
  });

  it('missing Authorization header: rejects with UnauthenticatedError, no principal attached', () => {
    const service = new FakeAccessTokenService(() => ({ sub: userId, role: 'CUSTOMER' }));

    const { req, error } = run(service, {});

    expect(error).toBeInstanceOf(UnauthenticatedError);
    expect((error as UnauthenticatedError).code).toBe('INVALID_ACCESS_TOKEN');
    expect(req.principal).toBeUndefined();
  });

  it('malformed Authorization header (no recognisable scheme): rejects', () => {
    const service = new FakeAccessTokenService(() => ({ sub: userId, role: 'CUSTOMER' }));

    const { error } = run(service, { authorization: 'garbage-not-a-scheme' });

    expect(error).toBeInstanceOf(UnauthenticatedError);
  });

  it('non-Bearer scheme (e.g. Basic): rejects', () => {
    const service = new FakeAccessTokenService(() => ({ sub: userId, role: 'CUSTOMER' }));

    const { error } = run(service, { authorization: 'Basic dXNlcjpwYXNz' });

    expect(error).toBeInstanceOf(UnauthenticatedError);
  });

  it('Bearer scheme with an empty token: rejects without ever calling verify()', () => {
    const verifySpy = vi.fn<(token: string) => AccessTokenClaims>();
    const service = new FakeAccessTokenService(verifySpy);

    const { error } = run(service, { authorization: 'Bearer ' });

    expect(error).toBeInstanceOf(UnauthenticatedError);
    expect(verifySpy).not.toHaveBeenCalled();
  });

  it('invalid token: forwards the exact error AccessTokenService.verify() throws', () => {
    const service = new FakeAccessTokenService(() => {
      throw new UnauthenticatedError('Invalid or expired access token.', {
        code: 'INVALID_ACCESS_TOKEN',
      });
    });

    const { error } = run(service, { authorization: 'Bearer not-a-real-token' });

    expect(error).toBeInstanceOf(UnauthenticatedError);
    expect((error as UnauthenticatedError).code).toBe('INVALID_ACCESS_TOKEN');
  });

  it('expired token: rejects with the same uniform error as any other invalid token', () => {
    const service = new FakeAccessTokenService(() => {
      throw new UnauthenticatedError('Invalid or expired access token.', {
        code: 'INVALID_ACCESS_TOKEN',
      });
    });

    const { error } = run(service, { authorization: 'Bearer expired-token' });

    expect(error).toBeInstanceOf(UnauthenticatedError);
    expect((error as UnauthenticatedError).code).toBe('INVALID_ACCESS_TOKEN');
  });

  it('preserves the verified role exactly', () => {
    const service = new FakeAccessTokenService(() => ({ sub: userId, role: 'SUPER_ADMIN' }));

    const { req } = run(service, { authorization: 'Bearer token' });

    expect(req.principal?.role).toBe('SUPER_ADMIN');
  });

  it('preserves the verified user id exactly', () => {
    const service = new FakeAccessTokenService(() => ({ sub: userId, role: 'CUSTOMER' }));

    const { req } = run(service, { authorization: 'Bearer token' });

    expect(req.principal?.userId).toBe(userId);
  });
});
