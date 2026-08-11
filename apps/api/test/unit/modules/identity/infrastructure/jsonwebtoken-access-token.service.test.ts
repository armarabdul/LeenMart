import { describe, expect, it } from 'vitest';
import { FixedClock, UuidV7Generator } from '@leen-mart/domain-kit';
import jwt from 'jsonwebtoken';
import { toUserId } from '../../../../../src/modules/identity/domain/value-objects/user-id.value-object.js';
import { toSessionId } from '../../../../../src/modules/identity/domain/value-objects/session-id.value-object.js';
import { JsonWebTokenAccessTokenService } from '../../../../../src/modules/identity/infrastructure/security/jsonwebtoken-access-token.service.js';

const userId = toUserId('00000000-0000-7000-8000-000000000099');
const sessionId = toSessionId('00000000-0000-7000-8000-0000000000aa');
const SECRET = 'a'.repeat(32);
const ISSUER = 'leen-mart-api';
const AUDIENCE = 'leen-mart-api';

const buildService = (
  overrides: Partial<{
    secret: string;
    issuer: string;
    audience: string;
    ttlSeconds: number;
  }> = {},
): JsonWebTokenAccessTokenService =>
  new JsonWebTokenAccessTokenService(
    { secret: SECRET, issuer: ISSUER, audience: AUDIENCE, ttlSeconds: 900, ...overrides },
    new FixedClock(new Date('2026-01-01T00:00:00.000Z')),
    new UuidV7Generator(),
  );

const subject = { sub: userId, sid: sessionId, role: 'CUSTOMER' } as const;

/** Reads the raw payload without verifying, so tests can assert on claims `verify()` does not surface. */
const decode = (token: string): Record<string, unknown> =>
  jwt.decode(token) as Record<string, unknown>;

describe('JsonWebTokenAccessTokenService', () => {
  it('signs a token that verifies back to the same claims', () => {
    const service = buildService();

    const signed = service.sign(subject);
    const claims = service.verify(signed.token);

    expect(claims.sub).toBe(userId);
    expect(claims.sid).toBe(sessionId);
    expect(claims.role).toBe('CUSTOMER');
    expect(claims.jti).toEqual(expect.any(String) as unknown as string);
  });

  it('carries every claim SDD 7.2 requires', () => {
    const service = buildService();

    const payload = decode(service.sign(subject).token);

    // `vendorId` is deliberately absent — optional in SDD 7.2 and read by
    // nothing, so emitting it would sign a value no code validates.
    for (const claim of ['sub', 'sid', 'jti', 'role', 'iss', 'aud', 'exp', 'iat']) {
      expect(payload).toHaveProperty(claim);
    }
  });

  it('round-trips sid unchanged', () => {
    const service = buildService();
    const other = toSessionId('00000000-0000-7000-8000-0000000000bb');

    const claims = service.verify(service.sign({ ...subject, sid: other }).token);

    expect(claims.sid).toBe(other);
  });

  it('round-trips aud unchanged', () => {
    const service = buildService({ audience: 'leen-mart-admin' });

    expect(decode(service.sign(subject).token).aud).toBe('leen-mart-admin');
  });

  it('gives every issued token its own jti', () => {
    const service = buildService();

    const jtis = new Set(
      Array.from({ length: 50 }, () => service.verify(service.sign(subject).token).jti),
    );

    expect(jtis.size).toBe(50);
  });

  it('computes expiresAt from the configured TTL via the injected clock', () => {
    const service = buildService({ ttlSeconds: 60 });

    const signed = service.sign(subject);

    expect(signed.expiresAt).toEqual(new Date('2026-01-01T00:01:00.000Z'));
  });

  it('rejects a token signed with a different secret', () => {
    const service = buildService({ secret: 'a'.repeat(32) });
    const other = buildService({ secret: 'b'.repeat(32) });
    const signed = service.sign(subject);

    expect(() => other.verify(signed.token)).toThrow(/Invalid or expired access token/);
  });

  it('rejects a token issued for a different issuer', () => {
    const service = buildService({ issuer: ISSUER });
    const other = buildService({ issuer: 'some-other-service' });
    const signed = service.sign(subject);

    expect(() => other.verify(signed.token)).toThrow(/Invalid or expired access token/);
  });

  it('rejects a token minted for a different audience', () => {
    // The point of `aud`: another service's token, signed with the same
    // secret and issuer, must not authenticate here.
    const service = buildService({ audience: 'leen-mart-api' });
    const other = buildService({ audience: 'some-other-audience' });
    const signed = service.sign(subject);

    expect(() => other.verify(signed.token)).toThrow(/Invalid or expired access token/);
  });

  it('rejects a well-signed token that is missing sid', () => {
    // A token minted before `sid` existed, or hand-crafted without it, must
    // not authenticate — there would be no session to check for revocation.
    const service = buildService();
    const forged = jwt.sign({ role: 'CUSTOMER' }, SECRET, {
      subject: userId,
      issuer: ISSUER,
      audience: AUDIENCE,
      jwtid: 'some-jti',
      expiresIn: 900,
    });

    expect(() => service.verify(forged)).toThrow(/Invalid or expired access token/);
  });

  it('rejects a well-signed token carrying an unknown role', () => {
    const service = buildService();
    const forged = jwt.sign({ role: 'SUPREME_LEADER', sid: sessionId }, SECRET, {
      subject: userId,
      issuer: ISSUER,
      audience: AUDIENCE,
      jwtid: 'some-jti',
      expiresIn: 900,
    });

    expect(() => service.verify(forged)).toThrow(/Invalid or expired access token/);
  });

  it('rejects an expired token', () => {
    const service = buildService();
    const expired = jwt.sign({ role: 'CUSTOMER', sid: sessionId }, SECRET, {
      subject: userId,
      issuer: ISSUER,
      audience: AUDIENCE,
      jwtid: 'some-jti',
      expiresIn: -60,
    });

    expect(() => service.verify(expired)).toThrow(/Invalid or expired access token/);
  });

  it('rejects a malformed token', () => {
    const service = buildService();

    expect(() => service.verify('not-a-jwt')).toThrow(/Invalid or expired access token/);
  });

  it('answers every rejection identically, so a caller cannot learn why (SEC-15)', () => {
    const service = buildService();
    const wrongSecret = buildService({ secret: 'b'.repeat(32) }).sign(subject).token;
    const wrongAudience = buildService({ audience: 'elsewhere' }).sign(subject).token;

    const messages = [wrongSecret, wrongAudience, 'not-a-jwt'].map((token) => {
      try {
        service.verify(token);
        throw new Error('expected verification to fail');
      } catch (error) {
        return (error as Error).message;
      }
    });

    expect(new Set(messages).size).toBe(1);
  });

  describe('algorithm allowlist (SDD 24 / OWASP A02)', () => {
    /** Builds a token bypassing the service, so the header names whatever we choose. */
    const forge = (options: jwt.SignOptions, secret: jwt.Secret = SECRET): string =>
      jwt.sign({ role: 'CUSTOMER', sid: sessionId }, secret, {
        subject: userId,
        issuer: ISSUER,
        audience: AUDIENCE,
        jwtid: 'forged-token-id',
        expiresIn: 900,
        ...options,
      });

    it('accepts the HS256 token it issues itself', () => {
      const service = buildService();

      const claims = service.verify(service.sign(subject).token);

      expect(claims.sub).toBe(userId);
    });

    it('stamps HS256 in the header of every token it signs', () => {
      const service = buildService();

      const header = JSON.parse(
        Buffer.from(service.sign(subject).token.split('.')[0] ?? '', 'base64url').toString('utf8'),
      ) as { alg: string };

      expect(header.alg).toBe('HS256');
    });

    it('rejects an unsigned alg:none token', () => {
      // The classic bypass: strip the signature and claim no algorithm was
      // used. `jsonwebtoken` will honour that header unless pinned.
      const service = buildService();
      const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
      const payload = Buffer.from(
        JSON.stringify({
          sub: userId,
          sid: sessionId,
          jti: 'forged',
          role: 'SUPER_ADMIN',
          iss: ISSUER,
          aud: AUDIENCE,
          exp: Math.floor(Date.now() / 1000) + 900,
        }),
      ).toString('base64url');

      expect(() => service.verify(`${header}.${payload}.`)).toThrow(
        /Invalid or expired access token/,
      );
    });

    it.each(['HS384', 'HS512'] as const)('rejects a token signed with %s', (algorithm) => {
      // Same secret, same issuer, same audience — only the algorithm differs.
      const service = buildService();

      expect(() => service.verify(forge({ algorithm }))).toThrow(/Invalid or expired access token/);
    });

    it('rejects a privilege-escalating token that differs only by algorithm', () => {
      // Proves the allowlist is what refuses it, not some other check: the
      // token is internally consistent and would otherwise mint an admin.
      const service = buildService();
      const escalated = jwt.sign({ role: 'SUPER_ADMIN', sid: sessionId }, SECRET, {
        algorithm: 'HS512',
        subject: userId,
        issuer: ISSUER,
        audience: AUDIENCE,
        jwtid: 'forged-admin',
        expiresIn: 900,
      });

      expect(() => service.verify(escalated)).toThrow(/Invalid or expired access token/);
    });

    it('answers a wrong-algorithm token with the same uniform error as any other failure (SEC-15)', () => {
      const service = buildService();

      const messages = [
        forge({ algorithm: 'HS512' }),
        buildService({ audience: 'elsewhere' }).sign(subject).token,
        'not-a-jwt',
      ].map((token) => {
        try {
          service.verify(token);
          throw new Error('expected verification to fail');
        } catch (error) {
          return (error as Error).message;
        }
      });

      expect(new Set(messages).size).toBe(1);
    });

    it('still enforces issuer, audience and expiry alongside the algorithm', () => {
      // Pinning the algorithm must not have displaced the other checks.
      const service = buildService();

      expect(() => service.verify(forge({ issuer: 'someone-else' }))).toThrow(
        /Invalid or expired access token/,
      );
      expect(() => service.verify(forge({ audience: 'someone-else' }))).toThrow(
        /Invalid or expired access token/,
      );
      expect(() => service.verify(forge({ expiresIn: -60 }))).toThrow(
        /Invalid or expired access token/,
      );
      // ...and a correctly-algorithmed token with all three right still passes.
      expect(() => service.verify(forge({}))).not.toThrow();
    });
  });
});
