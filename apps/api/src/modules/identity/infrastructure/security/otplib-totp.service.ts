import { OTP } from 'otplib';
import type { TotpService } from '../../domain/services/totp.service.js';

// SDD 7.1 requires TOTP but specifies no parameters; these are the RFC
// 6238 / Google-Authenticator-compatible defaults (approved design).
const ALGORITHM = 'sha1';
const DIGITS = 6;
const PERIOD_SECONDS = 30;
/** ±1 time step. `otplib`'s tolerance is in seconds, not steps. */
const DRIFT_TOLERANCE_SECONDS = PERIOD_SECONDS;
/** 160 bits — RFC 4226's recommended minimum secret length. */
const SECRET_BYTE_LENGTH = 20;

export class OtplibTotpService implements TotpService {
  private readonly otp = new OTP({ strategy: 'totp' });

  generateSecret(): string {
    return this.otp.generateSecret(SECRET_BYTE_LENGTH);
  }

  async verify(params: { secret: string; token: string; now: Date }): Promise<boolean> {
    // A malformed token (wrong shape, non-numeric) is a failed verification,
    // not an application error — same "never throw, just say no" contract
    // as `PasswordHasher.verify()`.
    try {
      const result = await this.otp.verify({
        secret: params.secret,
        token: params.token,
        algorithm: ALGORITHM,
        digits: DIGITS,
        period: PERIOD_SECONDS,
        epoch: Math.floor(params.now.getTime() / 1000),
        epochTolerance: DRIFT_TOLERANCE_SECONDS,
      });
      return result.valid;
    } catch {
      return false;
    }
  }
}
