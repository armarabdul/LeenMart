import { InvalidOtpError } from '../errors/identity-errors.js';

// Assumption (not stated by the spec): a 6-digit numeric code, the
// conventional OTP length. Revisit here if the product requirement differs.
const OTP_CODE_PATTERN = /^\d{6}$/;

/** A one-time code, compared verbatim against what was issued — no format leniency. */
export class OtpCode {
  private constructor(public readonly value: string) {}

  static create(value: string): OtpCode {
    if (!OTP_CODE_PATTERN.test(value)) {
      throw new InvalidOtpError({
        details: [{ field: 'otpCode', issue: 'must be a 6-digit numeric code' }],
      });
    }
    return new OtpCode(value);
  }

  equals(other: OtpCode): boolean {
    return this.value === other.value;
  }
}
