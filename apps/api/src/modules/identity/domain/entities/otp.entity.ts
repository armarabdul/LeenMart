import type { OtpId } from '../value-objects/otp-id.value-object.js';
import type { UserId } from '../value-objects/user-id.value-object.js';
import type { OtpCode } from '../value-objects/otp-code.value-object.js';
import { ExpiredOtpError, InvalidOtpError } from '../errors/identity-errors.js';

export interface OtpProps {
  readonly id: OtpId;
  readonly userId: UserId;
  readonly code: OtpCode;
  readonly attempts: number;
  readonly expiresAt: Date;
  readonly consumedAt: Date | null;
  readonly createdAt: Date;
}

const VALIDITY_MINUTES = 5;
const MS_PER_MINUTE = 60_000;

/**
 * A one-time verification code. Single use, capped at 5 attempts, valid for
 * 5 minutes from issuance — enforced here so no caller can forget one of the
 * three rules.
 *
 * Mirrors `Session`'s shape deliberately: predicates (`isExpired`,
 * `isConsumed`, ...) plus immutable transitions. Unlike `Session.revoke()`,
 * the transitions here reject a call that would violate a stated invariant
 * (already used, already exhausted, expired) rather than silently
 * succeeding — "single use" and "maximum 5 attempts" are invariants to
 * enforce, not just data to record.
 */
export class Otp {
  static readonly MAX_ATTEMPTS = 5;

  private constructor(private readonly props: OtpProps) {}

  static issue(props: { id: OtpId; userId: UserId; code: OtpCode; now: Date }): Otp {
    return new Otp({
      id: props.id,
      userId: props.userId,
      code: props.code,
      attempts: 0,
      expiresAt: new Date(props.now.getTime() + VALIDITY_MINUTES * MS_PER_MINUTE),
      consumedAt: null,
      createdAt: props.now,
    });
  }

  static reconstitute(props: OtpProps): Otp {
    return new Otp(props);
  }

  get id(): OtpId {
    return this.props.id;
  }

  get userId(): UserId {
    return this.props.userId;
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
    return this.props.attempts >= Otp.MAX_ATTEMPTS;
  }

  isActive(now: Date): boolean {
    return !this.isExpired(now) && !this.isConsumed() && !this.hasExceededMaxAttempts();
  }

  /** Pure comparison — recording the attempt is a separate step (`recordFailedAttempt`). */
  matches(code: OtpCode): boolean {
    return this.props.code.equals(code);
  }

  recordFailedAttempt(now: Date): Otp {
    if (!this.isActive(now)) {
      throw new InvalidOtpError({
        details: [{ field: 'otpCode', issue: 'this code is no longer accepting attempts' }],
      });
    }
    return new Otp({ ...this.props, attempts: this.props.attempts + 1 });
  }

  consume(now: Date): Otp {
    if (this.isExpired(now)) {
      throw new ExpiredOtpError();
    }
    if (this.isConsumed() || this.hasExceededMaxAttempts()) {
      throw new InvalidOtpError({
        details: [{ field: 'otpCode', issue: 'this code has already been used or exhausted' }],
      });
    }
    return new Otp({ ...this.props, consumedAt: now });
  }
}
