import { describe, expect, it } from 'vitest';
import { RefreshToken } from '../../../../../src/modules/identity/domain/entities/refresh-token.entity.js';
import { toSessionId } from '../../../../../src/modules/identity/domain/value-objects/session-id.value-object.js';
import { toUserId } from '../../../../../src/modules/identity/domain/value-objects/user-id.value-object.js';

const tokenId = toSessionId('00000000-0000-7000-8000-000000000010');
const userId = toUserId('00000000-0000-7000-8000-000000000011');
const replacementId = toSessionId('00000000-0000-7000-8000-000000000012');
const otherFamilyId = toSessionId('00000000-0000-7000-8000-000000000013');

const issue = (now: Date, expiresAt: Date): RefreshToken =>
  RefreshToken.issue({ id: tokenId, userId, tokenHash: 'hash', expiresAt, now });

describe('RefreshToken', () => {
  it('is active when neither expired nor revoked', () => {
    const now = new Date('2026-01-01T00:00:00.000Z');
    const token = issue(now, new Date('2026-02-01T00:00:00.000Z'));

    expect(token.isExpired(now)).toBe(false);
    expect(token.isRevoked()).toBe(false);
    expect(token.isActive(now)).toBe(true);
  });

  it('treats a token at or past its expiry as expired', () => {
    const expiresAt = new Date('2026-02-01T00:00:00.000Z');
    const token = issue(new Date('2026-01-01T00:00:00.000Z'), expiresAt);

    expect(token.isExpired(expiresAt)).toBe(true);
    expect(token.isActive(expiresAt)).toBe(false);
  });

  it('records rotation: revoking with a replacement links the two tokens', () => {
    const now = new Date('2026-01-01T00:00:00.000Z');
    const token = issue(now, new Date('2026-02-01T00:00:00.000Z'));
    const revokedAt = new Date('2026-01-15T00:00:00.000Z');

    const rotated = token.revoke(revokedAt, replacementId);

    expect(rotated.isRevoked()).toBe(true);
    expect(rotated.revokedAt).toEqual(revokedAt);
    expect(rotated.replacedByTokenId).toBe(replacementId);
    expect(rotated.isActive(revokedAt)).toBe(false);
    // Revocation returns a new instance; the original is untouched.
    expect(token.isRevoked()).toBe(false);
  });

  it('revokes without rotation (logout) leaving no replacement', () => {
    const now = new Date('2026-01-01T00:00:00.000Z');
    const token = issue(now, new Date('2026-02-01T00:00:00.000Z'));

    const revoked = token.revoke(now);

    expect(revoked.isRevoked()).toBe(true);
    expect(revoked.replacedByTokenId).toBeNull();
  });

  describe('session family (SDD 7.2)', () => {
    const now = new Date('2026-01-01T00:00:00.000Z');
    const expiresAt = new Date('2026-02-01T00:00:00.000Z');

    it('roots a fresh login at its own id, so every session has exactly one family', () => {
      expect(issue(now, expiresAt).familyId).toBe(tokenId);
    });

    it('continues an existing family when one is supplied', () => {
      const rotated = RefreshToken.issue({
        id: replacementId,
        userId,
        tokenHash: 'hash-2',
        expiresAt,
        now,
        familyId: otherFamilyId,
      });

      expect(rotated.familyId).toBe(otherFamilyId);
      expect(rotated.id).toBe(replacementId);
    });

    it('carries the family through revocation', () => {
      const token = issue(now, expiresAt);

      expect(token.revoke(now, replacementId).familyId).toBe(tokenId);
      expect(token.revoke(now).familyId).toBe(tokenId);
    });

    it('carries the family through reconstitution, without defaulting it to the id', () => {
      const rehydrated = RefreshToken.reconstitute({
        id: tokenId,
        userId,
        familyId: otherFamilyId,
        tokenHash: 'hash',
        expiresAt,
        revokedAt: null,
        replacedByTokenId: null,
        createdAt: now,
      });

      expect(rehydrated.familyId).toBe(otherFamilyId);
    });
  });

  describe('wasRotatedAway — the theft signal SDD 7.2 acts on', () => {
    const now = new Date('2026-01-01T00:00:00.000Z');
    const expiresAt = new Date('2026-02-01T00:00:00.000Z');

    it('is false for a live token', () => {
      expect(issue(now, expiresAt).wasRotatedAway()).toBe(false);
    });

    it('is true once the token has been exchanged for a replacement', () => {
      expect(issue(now, expiresAt).revoke(now, replacementId).wasRotatedAway()).toBe(true);
    });

    it('is false for a logout-revoked token, which is a stale client and not a thief', () => {
      const loggedOut = issue(now, expiresAt).revoke(now);

      expect(loggedOut.isRevoked()).toBe(true);
      expect(loggedOut.wasRotatedAway()).toBe(false);
    });

    it('is false for a merely expired token', () => {
      const expired = issue(now, expiresAt);

      expect(expired.isExpired(expiresAt)).toBe(true);
      expect(expired.wasRotatedAway()).toBe(false);
    });
  });
});
