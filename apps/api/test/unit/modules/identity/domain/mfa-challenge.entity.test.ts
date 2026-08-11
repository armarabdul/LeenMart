import { describe, expect, it } from 'vitest';
import { toUserId } from '../../../../../src/modules/identity/domain/value-objects/user-id.value-object.js';
import { toMfaChallengeId } from '../../../../../src/modules/identity/domain/value-objects/mfa-challenge-id.value-object.js';
import { MfaChallenge } from '../../../../../src/modules/identity/domain/entities/mfa-challenge.entity.js';
import {
  ExpiredMfaChallengeError,
  InvalidMfaChallengeError,
} from '../../../../../src/modules/identity/domain/errors/identity-errors.js';

const id = toMfaChallengeId('00000000-0000-7000-8000-0000000000f1');
const userId = toUserId('00000000-0000-7000-8000-0000000000f2');
const now = new Date('2026-01-01T00:00:00.000Z');

const issue = (): MfaChallenge =>
  MfaChallenge.issue({ id, userId, tokenHash: 'hash-of-token', now });

describe('MfaChallenge', () => {
  it('issues with zero attempts, unconsumed, expiring 5 minutes from now', () => {
    const challenge = issue();

    expect(challenge.id).toBe(id);
    expect(challenge.userId).toBe(userId);
    expect(challenge.tokenHash).toBe('hash-of-token');
    expect(challenge.attempts).toBe(0);
    expect(challenge.consumedAt).toBeNull();
    expect(challenge.expiresAt).toEqual(new Date('2026-01-01T00:05:00.000Z'));
  });

  it('is active immediately after issuance', () => {
    expect(issue().isActive(now)).toBe(true);
  });

  it('is not expired before its 5-minute window elapses', () => {
    const challenge = issue();
    expect(challenge.isExpired(new Date('2026-01-01T00:04:59.999Z'))).toBe(false);
  });

  it('is expired exactly at the 5-minute boundary', () => {
    const challenge = issue();
    expect(challenge.isExpired(new Date('2026-01-01T00:05:00.000Z'))).toBe(true);
  });

  it('becomes inactive once expired', () => {
    const challenge = issue();
    expect(challenge.isActive(new Date('2026-01-01T00:05:00.000Z'))).toBe(false);
  });

  describe('recordFailedAttempt', () => {
    it('increments attempts and returns a new instance', () => {
      const challenge = issue();

      const afterAttempt = challenge.recordFailedAttempt(now);

      expect(afterAttempt.attempts).toBe(1);
      expect(afterAttempt).not.toBe(challenge);
      expect(challenge.attempts).toBe(0);
    });

    it('throws ExpiredMfaChallengeError once expired', () => {
      const challenge = issue();
      expect(() => challenge.recordFailedAttempt(new Date('2026-01-01T00:05:00.000Z'))).toThrow(
        ExpiredMfaChallengeError,
      );
    });

    it('throws InvalidMfaChallengeError once already consumed', () => {
      const challenge = issue().consume(now);
      expect(() => challenge.recordFailedAttempt(now)).toThrow(InvalidMfaChallengeError);
    });

    it('throws InvalidMfaChallengeError once max attempts are exhausted', () => {
      let challenge = issue();
      for (let i = 0; i < MfaChallenge.MAX_ATTEMPTS; i += 1) {
        challenge = challenge.recordFailedAttempt(now);
      }

      expect(challenge.hasExceededMaxAttempts()).toBe(true);
      expect(() => challenge.recordFailedAttempt(now)).toThrow(InvalidMfaChallengeError);
    });
  });

  describe('consume', () => {
    it('sets consumedAt on a valid challenge', () => {
      const challenge = issue();

      const consumed = challenge.consume(now);

      expect(consumed.isConsumed()).toBe(true);
      expect(consumed.consumedAt).toEqual(now);
      expect(challenge.isConsumed()).toBe(false);
    });

    it('throws ExpiredMfaChallengeError once expired, even with attempts remaining', () => {
      const challenge = issue();
      expect(() => challenge.consume(new Date('2026-01-01T00:05:00.000Z'))).toThrow(
        ExpiredMfaChallengeError,
      );
    });

    it('throws InvalidMfaChallengeError on replay — consuming an already-consumed challenge', () => {
      const challenge = issue().consume(now);
      expect(() => challenge.consume(now)).toThrow(InvalidMfaChallengeError);
    });

    it('throws InvalidMfaChallengeError once max attempts are exhausted', () => {
      let challenge = issue();
      for (let i = 0; i < MfaChallenge.MAX_ATTEMPTS; i += 1) {
        challenge = challenge.recordFailedAttempt(now);
      }

      expect(() => challenge.consume(now)).toThrow(InvalidMfaChallengeError);
    });
  });

  it('reconstitutes a persisted challenge without defaulting its state', () => {
    const consumedAt = new Date('2026-01-01T00:02:00.000Z');
    const challenge = MfaChallenge.reconstitute({
      id,
      userId,
      tokenHash: 'hash-of-token',
      attempts: 3,
      expiresAt: new Date('2026-01-01T00:05:00.000Z'),
      consumedAt,
      createdAt: now,
    });

    expect(challenge.attempts).toBe(3);
    expect(challenge.consumedAt).toEqual(consumedAt);
    expect(challenge.isConsumed()).toBe(true);
  });
});
