import { describe, expect, it } from 'vitest';
import type { Request } from 'express';
import { AUTH_RATE_LIMIT_KEYS } from '../../src/shared/interface/http/middleware/auth-rate-limit.js';

/**
 * The bucketing policy behind SDD 23.3's per-identity/per-phone/per-session
 * budgets. Enforcement — that the Nth request actually gets a 429 — is proved
 * against real Redis in `test/integration/identity.test.ts`; what is under
 * test here is *which requests share a ceiling*, which is the part that
 * decides whether the budget can be split or shared by an attacker.
 */

/** These key functions read `req.body` directly: they run before `validate()` by design. */
const requestWith = (body: unknown): Request => ({ body }) as Request;

const { identity, phone, session } = AUTH_RATE_LIMIT_KEYS;

describe('auth rate-limit bucketing (SDD 23.3)', () => {
  describe('requests with nothing to count', () => {
    it.each([
      ['a missing field', {}],
      ['a null body', null],
      ['an undefined body', undefined],
      ['a non-object body', 'not-an-object'],
      ['a blank string', { email: '   ', phone: '   ', refreshToken: '   ' }],
      ['a non-string value', { email: 42, phone: 42, refreshToken: 42 }],
    ])('returns no key for %s', (_label, body) => {
      // Without this, every anonymous request shares one bucket and an
      // attacker exhausts everybody's budget by posting empty bodies.
      expect(identity(requestWith(body))).toBeUndefined();
      expect(phone(requestWith(body))).toBeUndefined();
      expect(session(requestWith(body))).toBeUndefined();
    });
  });

  describe('bucket names', () => {
    it('never contains the raw credential or personal identifier', () => {
      const identityKey = identity(requestWith({ email: 'shopper@example.com' }));
      const phoneKey = phone(requestWith({ phone: '+919876543210' }));
      const sessionKey = session(requestWith({ refreshToken: 'super-secret-token' }));

      expect(identityKey).not.toContain('shopper');
      expect(identityKey).not.toContain('example');
      expect(phoneKey).not.toContain('9876543210');
      expect(sessionKey).not.toContain('super-secret-token');
    });

    it('is a fixed-width opaque digest', () => {
      expect(identity(requestWith({ email: 'a@example.com' }))).toMatch(/^[0-9a-f]{32}$/);
      expect(phone(requestWith({ phone: '+919876543210' }))).toMatch(/^[0-9a-f]{32}$/);
      expect(session(requestWith({ refreshToken: 'token' }))).toMatch(/^[0-9a-f]{32}$/);
    });

    it('is stable for the same subject', () => {
      expect(identity(requestWith({ email: 'a@example.com' }))).toBe(
        identity(requestWith({ email: 'a@example.com' })),
      );
    });
  });

  describe('identity normalisation', () => {
    it('shares a bucket across casing, matching emailSchema', () => {
      // Otherwise five attempts as `A@x.com` and five as `a@x.com` are ten
      // attempts against one account under a five-attempt ceiling.
      expect(identity(requestWith({ email: 'Shopper@Example.COM' }))).toBe(
        identity(requestWith({ email: 'shopper@example.com' })),
      );
    });

    it('shares a bucket across surrounding whitespace, matching emailSchema', () => {
      expect(identity(requestWith({ email: '  shopper@example.com  ' }))).toBe(
        identity(requestWith({ email: 'shopper@example.com' })),
      );
    });
  });

  describe('bucket separation', () => {
    it('gives different identities different buckets', () => {
      expect(identity(requestWith({ email: 'a@example.com' }))).not.toBe(
        identity(requestWith({ email: 'b@example.com' })),
      );
    });

    it('gives different phones different buckets', () => {
      expect(phone(requestWith({ phone: '+919876543210' }))).not.toBe(
        phone(requestWith({ phone: '+919876543211' })),
      );
    });

    it('gives different sessions different buckets', () => {
      expect(session(requestWith({ refreshToken: 'token-a' }))).not.toBe(
        session(requestWith({ refreshToken: 'token-b' })),
      );
    });
  });
});
