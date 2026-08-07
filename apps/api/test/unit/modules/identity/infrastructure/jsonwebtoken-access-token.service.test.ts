import { describe, expect, it } from 'vitest';
import { FixedClock, toUuid } from '@leen-mart/domain-kit';
import { JsonWebTokenAccessTokenService } from '../../../../../src/modules/identity/infrastructure/security/jsonwebtoken-access-token.service.js';

const userId = toUuid('00000000-0000-7000-8000-000000000099');

const buildService = (
  overrides: Partial<{ secret: string; issuer: string; ttlSeconds: number }> = {},
): JsonWebTokenAccessTokenService =>
  new JsonWebTokenAccessTokenService(
    { secret: 'a'.repeat(32), issuer: 'leen-mart-api', ttlSeconds: 900, ...overrides },
    new FixedClock(new Date('2026-01-01T00:00:00.000Z')),
  );

describe('JsonWebTokenAccessTokenService', () => {
  it('signs a token that verifies back to the same claims', () => {
    const service = buildService();

    const signed = service.sign({ sub: userId, role: 'CUSTOMER' });
    const claims = service.verify(signed.token);

    expect(claims).toEqual({ sub: userId, role: 'CUSTOMER' });
  });

  it('computes expiresAt from the configured TTL via the injected clock', () => {
    const service = buildService({ ttlSeconds: 60 });

    const signed = service.sign({ sub: userId, role: 'CUSTOMER' });

    expect(signed.expiresAt).toEqual(new Date('2026-01-01T00:01:00.000Z'));
  });

  it('rejects a token signed with a different secret', () => {
    const service = buildService({ secret: 'a'.repeat(32) });
    const other = buildService({ secret: 'b'.repeat(32) });
    const signed = service.sign({ sub: userId, role: 'CUSTOMER' });

    expect(() => other.verify(signed.token)).toThrow(/Invalid or expired access token/);
  });

  it('rejects a token issued for a different issuer', () => {
    const service = buildService({ issuer: 'leen-mart-api' });
    const other = buildService({ issuer: 'some-other-service' });
    const signed = service.sign({ sub: userId, role: 'CUSTOMER' });

    expect(() => other.verify(signed.token)).toThrow(/Invalid or expired access token/);
  });

  it('rejects a malformed token', () => {
    const service = buildService();

    expect(() => service.verify('not-a-jwt')).toThrow(/Invalid or expired access token/);
  });
});
