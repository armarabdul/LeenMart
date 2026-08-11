import { describe, expect, it } from 'vitest';
import {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  loginRequestSchema,
  registerCustomerRequestSchema,
} from '../src/index.js';

const password = (length: number): string => 'a'.repeat(length);

describe('identity contracts', () => {
  describe('password policy (SDD 7.5)', () => {
    it('sets the minimum at ten characters', () => {
      expect(PASSWORD_MIN_LENGTH).toBe(10);
    });

    it('accepts a password at the minimum length', () => {
      const parsed = registerCustomerRequestSchema.safeParse({
        email: 'shopper@example.com',
        password: password(PASSWORD_MIN_LENGTH),
      });

      expect(parsed.success).toBe(true);
    });

    it('rejects a password one character short', () => {
      const parsed = registerCustomerRequestSchema.safeParse({
        email: 'shopper@example.com',
        password: password(PASSWORD_MIN_LENGTH - 1),
      });

      expect(parsed.success).toBe(false);
    });

    it('rejects a password beyond the maximum, capping hashing work', () => {
      const parsed = registerCustomerRequestSchema.safeParse({
        email: 'shopper@example.com',
        password: password(PASSWORD_MAX_LENGTH + 1),
      });

      expect(parsed.success).toBe(false);
    });
  });

  describe('login', () => {
    it('accepts a password shorter than the policy minimum', () => {
      // Not an oversight: rejecting a short password at the schema would tell
      // an attacker their guess was too short to be this account's password.
      // The credential check fails uniformly instead (SEC-15).
      const parsed = loginRequestSchema.safeParse({
        email: 'shopper@example.com',
        password: 'a',
      });

      expect(parsed.success).toBe(true);
    });

    it('still rejects an empty password', () => {
      const parsed = loginRequestSchema.safeParse({
        email: 'shopper@example.com',
        password: '',
      });

      expect(parsed.success).toBe(false);
    });
  });

  describe('mass assignment (SEC-12)', () => {
    it('rejects a role the client should not be able to set', () => {
      const parsed = registerCustomerRequestSchema.safeParse({
        email: 'shopper@example.com',
        password: password(PASSWORD_MIN_LENGTH),
        role: 'SUPER_ADMIN',
      });

      expect(parsed.success).toBe(false);
    });
  });
});
