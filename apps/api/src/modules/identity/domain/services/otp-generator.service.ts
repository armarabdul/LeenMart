import type { OtpCode } from '../value-objects/otp-code.value-object.js';

export interface OtpGenerator {
  generate(): OtpCode;
}
