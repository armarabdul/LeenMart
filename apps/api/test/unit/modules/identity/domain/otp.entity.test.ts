import { describe, expect, it } from 'vitest';
import { Otp } from '../../../../../src/modules/identity/domain/entities/otp.entity.js';
import { toUserId } from '../../../../../src/modules/identity/domain/value-objects/user-id.value-object.js';
import { toOtpId } from '../../../../../src/modules/identity/domain/value-objects/otp-id.value-object.js';
import {
  ExpiredOtpError,
  InvalidOtpError,
} from '../../../../../src/modules/identity/domain/errors/identity-errors.js';

const otpId = toOtpId('00000000-0000-7000-8000-000000000020');
const userId = toUserId('00000000-0000-7000-8000-000000000021');
const codeHash = '$argon2id$fake-hash-for-tests';

const issue = (now: Date): Otp => Otp.issue({ id: otpId, userId, codeHash, now });

describe('Otp', () => {
  it('is active immediately after issuance, expiring exactly 5 minutes later', () => {
    const now = new Date('2026-01-01T00:00:00.000Z');
    const otp = issue(now);

    expect(otp.isActive(now)).toBe(true);
    expect(otp.isExpired(new Date('2026-01-01T00:04:59.999Z'))).toBe(false);
    expect(otp.isExpired(new Date('2026-01-01T00:05:00.000Z'))).toBe(true);
  });

  it('never exposes the raw code — only the hash it was issued with', () => {
    const otp = issue(new Date('2026-01-01T00:00:00.000Z'));

    expect(otp.codeHash).toBe(codeHash);
  });

  it('tracks failed attempts up to the maximum, then stops accepting them', () => {
    const now = new Date('2026-01-01T00:00:00.000Z');
    let otp = issue(now);

    for (let i = 0; i < Otp.MAX_ATTEMPTS; i += 1) {
      otp = otp.recordFailedAttempt(now);
    }

    expect(otp.attempts).toBe(Otp.MAX_ATTEMPTS);
    expect(otp.hasExceededMaxAttempts()).toBe(true);
    expect(otp.isActive(now)).toBe(false);
    expect(() => otp.recordFailedAttempt(now)).toThrow(InvalidOtpError);
  });

  it('consumes exactly once', () => {
    const now = new Date('2026-01-01T00:00:00.000Z');
    const otp = issue(now);

    const consumed = otp.consume(now);

    expect(consumed.isConsumed()).toBe(true);
    expect(consumed.consumedAt).toEqual(now);
    // The original instance is untouched — consume() returns a new Otp.
    expect(otp.isConsumed()).toBe(false);
    expect(() => consumed.consume(now)).toThrow(InvalidOtpError);
  });

  it('refuses to consume an expired code, even if attempts remain', () => {
    const issuedAt = new Date('2026-01-01T00:00:00.000Z');
    const otp = issue(issuedAt);
    const afterExpiry = new Date('2026-01-01T00:05:00.000Z');

    expect(() => otp.consume(afterExpiry)).toThrow(ExpiredOtpError);
  });
});
