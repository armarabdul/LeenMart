import type { OtpId } from '../value-objects/otp-id.value-object.js';
import type { UserId } from '../value-objects/user-id.value-object.js';
import { ExpiredOtpError, InvalidOtpError } from '../errors/identity-errors.js';

export interface OtpProps {
  readonly id: OtpId;
  readonly userId: UserId;
  readonly codeHash: string;
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
 *
 * Holds `codeHash`, never the raw code — same reasoning as `Session.tokenHash`.
 * The caller hashes the freshly-generated code (via `OtpHasher`) before
 * calling `issue()`; this entity never sees the plaintext value. Because
 * Argon2 hashes are salted (non-deterministic), there is no entity-level
 * `matches()`/equality check — verifying a supplied code means calling
 * `OtpHasher.verify(otp.codeHash, suppliedCode)` at the application layer,
 * exactly mirroring how refresh-token verification has no entity-level
 * compare method either.
 */
export class Otp {
  static readonly MAX_ATTEMPTS = 5;

  private constructor(private readonly props: OtpProps) {}

  static issue(props: { id: OtpId; userId: UserId; codeHash: string; now: Date }): Otp {
    return new Otp({
      id: props.id,
      userId: props.userId,
      codeHash: props.codeHash,
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

  get codeHash(): string {
    return this.props.codeHash;
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
