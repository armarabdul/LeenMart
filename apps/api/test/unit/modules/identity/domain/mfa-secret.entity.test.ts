import { describe, expect, it } from 'vitest';
import { toUserId } from '../../../../../src/modules/identity/domain/value-objects/user-id.value-object.js';
import { toMfaSecretId } from '../../../../../src/modules/identity/domain/value-objects/mfa-secret-id.value-object.js';
import { MfaSecret } from '../../../../../src/modules/identity/domain/entities/mfa-secret.entity.js';

const id = toMfaSecretId('00000000-0000-7000-8000-0000000000e1');
const userId = toUserId('00000000-0000-7000-8000-0000000000e2');
const now = new Date('2026-01-01T00:00:00.000Z');

describe('MfaSecret', () => {
  it('enrolls as unconfirmed', () => {
    const secret = MfaSecret.enroll({ id, userId, encryptedSecret: 'ciphertext', now });

    expect(secret.id).toBe(id);
    expect(secret.userId).toBe(userId);
    expect(secret.encryptedSecret).toBe('ciphertext');
    expect(secret.confirmedAt).toBeNull();
    expect(secret.isConfirmed()).toBe(false);
    expect(secret.createdAt).toEqual(now);
    expect(secret.updatedAt).toEqual(now);
  });

  it('confirm() stamps confirmedAt and updatedAt without touching the secret', () => {
    const secret = MfaSecret.enroll({ id, userId, encryptedSecret: 'ciphertext', now });
    const confirmedAt = new Date('2026-01-01T00:05:00.000Z');

    const confirmed = secret.confirm(confirmedAt);

    expect(confirmed.isConfirmed()).toBe(true);
    expect(confirmed.confirmedAt).toEqual(confirmedAt);
    expect(confirmed.updatedAt).toEqual(confirmedAt);
    expect(confirmed.encryptedSecret).toBe('ciphertext');
    expect(confirmed.createdAt).toEqual(now);
  });

  it('confirm() returns a new instance rather than mutating the original', () => {
    const secret = MfaSecret.enroll({ id, userId, encryptedSecret: 'ciphertext', now });

    const confirmed = secret.confirm(new Date('2026-01-01T00:05:00.000Z'));

    expect(secret.isConfirmed()).toBe(false);
    expect(confirmed).not.toBe(secret);
  });

  it('reconstitutes a confirmed secret from persistence without defaulting confirmedAt', () => {
    const confirmedAt = new Date('2026-01-01T00:05:00.000Z');
    const secret = MfaSecret.reconstitute({
      id,
      userId,
      encryptedSecret: 'ciphertext',
      confirmedAt,
      createdAt: now,
      updatedAt: confirmedAt,
    });

    expect(secret.isConfirmed()).toBe(true);
    expect(secret.confirmedAt).toEqual(confirmedAt);
  });

  it('reconstitutes an unconfirmed secret from persistence', () => {
    const secret = MfaSecret.reconstitute({
      id,
      userId,
      encryptedSecret: 'ciphertext',
      confirmedAt: null,
      createdAt: now,
      updatedAt: now,
    });

    expect(secret.isConfirmed()).toBe(false);
  });
});
