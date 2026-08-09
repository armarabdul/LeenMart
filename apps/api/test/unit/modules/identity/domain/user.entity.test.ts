import { describe, expect, it } from 'vitest';
import { toUserId } from '../../../../../src/modules/identity/domain/value-objects/user-id.value-object.js';
import { Role } from '../../../../../src/modules/identity/domain/entities/role.entity.js';
import { User } from '../../../../../src/modules/identity/domain/entities/user.entity.js';

const userId = toUserId('00000000-0000-7000-8000-000000000001');

describe('User', () => {
  it('registers a new user as CUSTOMER regardless of anything the caller passes', () => {
    const now = new Date('2026-01-01T00:00:00.000Z');
    const user = User.register({
      id: userId,
      email: 'shopper@example.com',
      passwordHash: 'hash',
      now,
    });

    expect(user.role).toBe(Role.CUSTOMER);
    expect(user.email).toBe('shopper@example.com');
    expect(user.createdAt).toEqual(now);
    expect(user.updatedAt).toEqual(now);
  });

  it('reconstitutes a user with a persisted role rather than defaulting it', () => {
    const now = new Date('2026-01-01T00:00:00.000Z');
    const user = User.reconstitute({
      id: userId,
      email: 'vendor@example.com',
      passwordHash: 'hash',
      role: Role.VENDOR,
      createdAt: now,
      updatedAt: now,
    });

    expect(user.role).toBe(Role.VENDOR);
  });
});
