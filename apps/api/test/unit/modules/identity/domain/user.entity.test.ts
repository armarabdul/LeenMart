import { describe, expect, it } from 'vitest';
import { toUserId } from '../../../../../src/modules/identity/domain/value-objects/user-id.value-object.js';
import { PasswordHash } from '../../../../../src/modules/identity/domain/value-objects/password-hash.value-object.js';
import { UserStatus } from '../../../../../src/modules/identity/domain/value-objects/user-status.value-object.js';
import {
  ADMIN_ROLE_NAMES,
  Role,
} from '../../../../../src/modules/identity/domain/value-objects/role.value-object.js';
import { User } from '../../../../../src/modules/identity/domain/entities/user.entity.js';
import {
  AccountLockedError,
  AccountSuspendedError,
} from '../../../../../src/modules/identity/domain/errors/identity-errors.js';

const userId = toUserId('00000000-0000-7000-8000-000000000001');
const passwordHash = PasswordHash.create('argon2id$fake-hash-value-for-tests');

describe('User', () => {
  it('registers a new user as CUSTOMER regardless of anything the caller passes', () => {
    const now = new Date('2026-01-01T00:00:00.000Z');
    const user = User.register({
      id: userId,
      email: 'shopper@example.com',
      passwordHash,
      now,
    });

    expect(user.role).toBe(Role.CUSTOMER);
    expect(user.email).toBe('shopper@example.com');
    expect(user.createdAt).toEqual(now);
    expect(user.updatedAt).toEqual(now);
  });

  it.each(ADMIN_ROLE_NAMES)('registers an administrator with the %s role', (roleName) => {
    const now = new Date('2026-01-01T00:00:00.000Z');

    const admin = User.registerAdmin({
      id: userId,
      email: 'ops@leenmart.in',
      passwordHash,
      role: Role.fromName(roleName),
      now,
    });

    expect(admin.role.name).toBe(roleName);
    expect(admin.status).toBe(UserStatus.ACTIVE);
    expect(admin.createdAt).toEqual(now);
    expect(admin.updatedAt).toEqual(now);
  });

  it.each(['CUSTOMER', 'VENDOR_OWNER', 'VENDOR_MANAGER', 'VENDOR_STAFF'] as const)(
    'refuses to register %s as an administrator',
    (roleName) => {
      expect(() =>
        User.registerAdmin({
          id: userId,
          email: 'ops@leenmart.in',
          passwordHash,
          role: Role.fromName(roleName),
          now: new Date('2026-01-01T00:00:00.000Z'),
        }),
      ).toThrow(/Not an admin role/);
    },
  );

  it('reconstitutes a user with a persisted role rather than defaulting it', () => {
    const now = new Date('2026-01-01T00:00:00.000Z');
    const user = User.reconstitute({
      id: userId,
      email: 'vendor@example.com',
      passwordHash,
      role: Role.VENDOR_OWNER,
      status: UserStatus.ACTIVE,
      createdAt: now,
      updatedAt: now,
    });

    expect(user.role).toBe(Role.VENDOR_OWNER);
  });

  describe('assertCanAuthenticate (SDD 7.2)', () => {
    const now = new Date('2026-01-01T00:00:00.000Z');

    const inStatus = (status: UserStatus): User =>
      User.reconstitute({
        id: userId,
        email: 'shopper@example.com',
        passwordHash,
        role: Role.CUSTOMER,
        status,
        createdAt: now,
        updatedAt: now,
      });

    it('allows an active account', () => {
      expect(() => inStatus(UserStatus.ACTIVE).assertCanAuthenticate()).not.toThrow();
    });

    it('allows a pending account, which is activated by authenticating', () => {
      // A phone signup starts PENDING and is activated by `verifyPhone`.
      // Blocking it here would break the OTP flow rather than protect anything.
      expect(() => inStatus(UserStatus.PENDING).assertCanAuthenticate()).not.toThrow();
    });

    it('refuses a suspended account', () => {
      expect(() => inStatus(UserStatus.SUSPENDED).assertCanAuthenticate()).toThrow(
        AccountSuspendedError,
      );
    });

    it('refuses a locked account', () => {
      expect(() => inStatus(UserStatus.LOCKED).assertCanAuthenticate()).toThrow(AccountLockedError);
    });

    it('reports the refusal as a 403 with a stable code', () => {
      try {
        inStatus(UserStatus.SUSPENDED).assertCanAuthenticate();
        expect.unreachable('a suspended account should not authenticate');
      } catch (error) {
        const failure = error as AccountSuspendedError;
        expect(failure.kind).toBe('FORBIDDEN');
        expect(failure.code).toBe('ACCOUNT_SUSPENDED');
      }
    });

    it('does not mutate the account it refuses', () => {
      const suspended = inStatus(UserStatus.SUSPENDED);

      expect(() => suspended.assertCanAuthenticate()).toThrow();
      expect(suspended.status).toBe(UserStatus.SUSPENDED);
    });

    it('is the same guard activate() and verifyPhone() already applied', () => {
      // Both predate this method and refused exactly these two states; the
      // guard was extracted from them, so their behaviour must be unchanged.
      expect(() => inStatus(UserStatus.SUSPENDED).activate(now)).toThrow(AccountSuspendedError);
      expect(() => inStatus(UserStatus.LOCKED).activate(now)).toThrow(AccountLockedError);
      expect(() => inStatus(UserStatus.SUSPENDED).verifyPhone(now)).toThrow(AccountSuspendedError);
      expect(() => inStatus(UserStatus.LOCKED).verifyPhone(now)).toThrow(AccountLockedError);
      expect(() => inStatus(UserStatus.PENDING).verifyPhone(now)).not.toThrow();
    });
  });
});
