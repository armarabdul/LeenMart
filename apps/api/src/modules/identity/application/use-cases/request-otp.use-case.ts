import type { Clock, IdGenerator, Logger } from '@leen-mart/domain-kit';
import { User } from '../../domain/entities/user.entity.js';
import { Otp } from '../../domain/entities/otp.entity.js';
import { PhoneNumber } from '../../domain/value-objects/phone-number.value-object.js';
import { toUserId } from '../../domain/value-objects/user-id.value-object.js';
import { toOtpId } from '../../domain/value-objects/otp-id.value-object.js';
import type { OtpGenerator } from '../../domain/services/otp-generator.service.js';
import type { OtpHasher } from '../../domain/services/otp-hasher.service.js';
import type { OtpRepository } from '../../domain/repositories/otp.repository.js';
import type { UserRepository } from '../ports/user-repository.port.js';

export interface RequestOtpInput {
  readonly phone: string;
}

export interface RequestOtpDeps {
  readonly userRepository: UserRepository;
  readonly otpGenerator: OtpGenerator;
  readonly otpHasher: OtpHasher;
  readonly otpRepository: OtpRepository;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
  readonly logger: Logger;
}

/**
 * Requests a phone verification code (SDD 7.1's primary customer path).
 * Finds the existing account for this phone, or creates a new `PENDING`
 * one — either way, an OTP is generated, hashed, and persisted. The raw
 * code is never returned or logged; only `VerifyOtp` (a later step)
 * completes the flow. Real delivery (SMS) is not implemented yet — see
 * docs/identity-milestone2-backlog.md.
 */
export class RequestOtpUseCase {
  constructor(private readonly deps: RequestOtpDeps) {}

  async execute(input: RequestOtpInput): Promise<void> {
    const { userRepository, otpGenerator, otpHasher, otpRepository, idGenerator, clock, logger } =
      this.deps;

    const phone = PhoneNumber.create(input.phone);
    const now = clock.now();

    let user = await userRepository.findByPhone(phone);
    if (!user) {
      user = User.registerWithPhone({ id: toUserId(idGenerator.generate()), phone, now });
      await userRepository.create(user);
      logger.info({ userId: user.id }, 'New phone customer registered, pending verification');
    }

    const code = otpGenerator.generate();
    const codeHash = await otpHasher.hash(code.value);
    const otp = Otp.issue({ id: toOtpId(idGenerator.generate()), userId: user.id, codeHash, now });
    await otpRepository.create(otp);

    logger.info({ userId: user.id, otpId: otp.id }, 'OTP requested');
  }
}
