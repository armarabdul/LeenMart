import type { Clock, Logger } from '@leen-mart/domain-kit';
import { PhoneNumber } from '../../domain/value-objects/phone-number.value-object.js';
import { ExpiredOtpError, InvalidOtpError } from '../../domain/errors/identity-errors.js';
import type { OtpHasher } from '../../domain/services/otp-hasher.service.js';
import type { OtpRepository } from '../../domain/repositories/otp.repository.js';
import type { UserRepository } from '../ports/user-repository.port.js';
import type { AuthSession, SessionIssuer } from '../services/session-issuer.service.js';

export interface VerifyOtpInput {
  readonly phone: string;
  readonly code: string;
}

export interface VerifyOtpDeps {
  readonly userRepository: UserRepository;
  readonly otpHasher: OtpHasher;
  readonly otpRepository: OtpRepository;
  readonly sessionIssuer: SessionIssuer;
  readonly clock: Clock;
  readonly logger: Logger;
}

/**
 * Verifies a phone OTP and completes the primary customer sign-in path
 * (SDD 7.1). Reuses `SessionIssuer` exactly as register/login do — a
 * verified phone customer gets the same session shape as any other.
 *
 * All state checks (expired/consumed/exhausted) go through `Otp`'s own
 * predicates rather than being re-derived here, and the hasher is never
 * called once the OTP is already known to be unusable — there is nothing
 * to verify a code against if the OTP itself is already dead.
 */
export class VerifyOtpUseCase {
  constructor(private readonly deps: VerifyOtpDeps) {}

  async execute(input: VerifyOtpInput): Promise<AuthSession> {
    const { userRepository, otpHasher, otpRepository, sessionIssuer, clock, logger } = this.deps;

    const phone = PhoneNumber.create(input.phone);
    const now = clock.now();

    const user = await userRepository.findByPhone(phone);
    if (!user) {
      // Uniform with "no active OTP"/"wrong code" below — an unknown phone
      // must not be distinguishable from an invalid code (SEC-15).
      throw new InvalidOtpError();
    }

    // Administrators authenticate on their own surface, where TOTP is
    // mandatory and unconditional (SDD 7.1 gives Admin "Email + password"
    // with no secondary method at all). Refusing them here is what stops this
    // endpoint from becoming an MFA bypass, exactly as `LoginUseCase` refuses
    // them on the customer password path for the same reason.
    //
    // The rejection is `InvalidOtpError` — the same error, code and status
    // every other failure on this endpoint produces — and it happens before
    // the OTP is looked up, so nothing about the account is observable. Using
    // this path's uniform error rather than login's `InvalidCredentialsError`
    // is deliberate: the two are a 400 `INVALID_OTP` and a 401
    // `INVALID_CREDENTIALS` respectively, so borrowing login's would make an
    // administrator's phone number identifiable by a single request — the
    // very enumeration oracle (SEC-15) this guard is written to avoid.
    //
    // No admin account can hold a phone today: `User.registerWithPhone` is the
    // only path that sets one and it hardcodes `Role.CUSTOMER`. This is the
    // guard that keeps that true if a phone-change flow (FR-07) ever lands.
    if (user.role.isAdmin()) {
      logger.warn(
        { userId: user.id },
        'OTP verification refused: admin accounts must use the admin surface',
      );
      throw new InvalidOtpError();
    }

    const otp = await otpRepository.findActiveByUserId(user.id);
    if (!otp) {
      throw new InvalidOtpError();
    }
    if (otp.isExpired(now)) {
      throw new ExpiredOtpError();
    }
    if (otp.isConsumed() || otp.hasExceededMaxAttempts()) {
      throw new InvalidOtpError();
    }

    const isValid = await otpHasher.verify(otp.codeHash, input.code);
    if (!isValid) {
      await otpRepository.update(otp.recordFailedAttempt(now));
      logger.warn({ userId: user.id, otpId: otp.id }, 'OTP verification failed: wrong code');
      throw new InvalidOtpError();
    }

    await otpRepository.update(otp.consume(now));

    const verifiedUser = user.verifyPhone(now);
    await userRepository.update(verifiedUser);

    logger.info({ userId: user.id, otpId: otp.id }, 'Phone verified');
    return sessionIssuer.issueFor(verifiedUser);
  }
}
