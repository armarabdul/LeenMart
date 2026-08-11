import type { MfaChallengeId } from '../value-objects/mfa-challenge-id.value-object.js';
import type { UserId } from '../value-objects/user-id.value-object.js';
import { ExpiredMfaChallengeError, InvalidMfaChallengeError } from '../errors/identity-errors.js';

export interface MfaChallengeProps {
  readonly id: MfaChallengeId;
  readonly userId: UserId;
  readonly tokenHash: string;
  readonly attempts: number;
  readonly expiresAt: Date;
  readonly consumedAt: Date | null;
  readonly createdAt: Date;
}

const VALIDITY_MINUTES = 5;
const MS_PER_MINUTE = 60_000;

/**
 * The record of an admin who has passed step 1 (password) of login and now
 * has one window to prove TOTP possession (SDD 7.1: mandatory TOTP, always).
 * Single use, capped at 5 attempts, valid for 5 minutes — the same shape
 * SDD 7.3 already specifies for phone-OTP challenges, applied here because
 * the SDD gives no separate MFA-challenge spec of its own.
 *
 * Holds `tokenHash`, never the raw challenge token — mirrors
 * `Session.tokenHash`, not `Otp.codeHash`: the token this entity protects is
 * a high-entropy opaque bearer value the server hands the client after step
 * 1, not a low-entropy code the client must recite back. It carries no TOTP
 * code or secret at all — TOTP verification is computed live against the
 * (separately encrypted) `MfaSecret`, never stored here.
 */
export class MfaChallenge {
  static readonly MAX_ATTEMPTS = 5;

  private constructor(private readonly props: MfaChallengeProps) {}

  static issue(props: {
    id: MfaChallengeId;
    userId: UserId;
    tokenHash: string;
    now: Date;
  }): MfaChallenge {
    return new MfaChallenge({
      id: props.id,
      userId: props.userId,
      tokenHash: props.tokenHash,
      attempts: 0,
      expiresAt: new Date(props.now.getTime() + VALIDITY_MINUTES * MS_PER_MINUTE),
      consumedAt: null,
      createdAt: props.now,
    });
  }

  static reconstitute(props: MfaChallengeProps): MfaChallenge {
    return new MfaChallenge(props);
  }

  get id(): MfaChallengeId {
    return this.props.id;
  }

  get userId(): UserId {
    return this.props.userId;
  }

  get tokenHash(): string {
    return this.props.tokenHash;
  }

  get attempts(): number {
    return this.props.attempts;
  }

  get expiresAt(): Date {
    return this.props.expiresAt;
  }

  get consumedAt(): Date | null {
    return this.props.consumedAt;
  }

  isExpired(now: Date): boolean {
    return this.props.expiresAt.getTime() <= now.getTime();
  }

  isConsumed(): boolean {
    return this.props.consumedAt !== null;
  }

  hasExceededMaxAttempts(): boolean {
    return this.props.attempts >= MfaChallenge.MAX_ATTEMPTS;
  }

  isActive(now: Date): boolean {
    return !this.isExpired(now) && !this.isConsumed() && !this.hasExceededMaxAttempts();
  }

  recordFailedAttempt(now: Date): MfaChallenge {
    if (this.isExpired(now)) {
      throw new ExpiredMfaChallengeError();
    }
    if (this.isConsumed() || this.hasExceededMaxAttempts()) {
      throw new InvalidMfaChallengeError({
        details: [
          { field: 'mfaChallenge', issue: 'this challenge is no longer accepting attempts' },
        ],
      });
    }
    return new MfaChallenge({ ...this.props, attempts: this.props.attempts + 1 });
  }

  consume(now: Date): MfaChallenge {
    if (this.isExpired(now)) {
      throw new ExpiredMfaChallengeError();
    }
    if (this.isConsumed() || this.hasExceededMaxAttempts()) {
      throw new InvalidMfaChallengeError({
        details: [
          { field: 'mfaChallenge', issue: 'this challenge has already been used or exhausted' },
        ],
      });
    }
    return new MfaChallenge({ ...this.props, consumedAt: now });
  }
}
