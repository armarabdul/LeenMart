import { randomInt } from 'node:crypto';
import type { OtpGenerator } from '../../domain/services/otp-generator.service.js';
import { OtpCode } from '../../domain/value-objects/otp-code.value-object.js';

const OTP_CODE_LENGTH = 6;
const OTP_UPPER_BOUND = 1_000_000; // 10^6 — exclusive upper bound for randomInt

export class CryptoOtpGenerator implements OtpGenerator {
  generate(): OtpCode {
    // `randomInt`'s rejection sampling (not modulo) is what makes this
    // uniform across [0, 999999] — a plain `randomBytes(...) % 1_000_000`
    // would be biased toward the low end of the range.
    const value = randomInt(0, OTP_UPPER_BOUND);
    return OtpCode.create(value.toString().padStart(OTP_CODE_LENGTH, '0'));
  }
}
