import type { OtpId } from '../value-objects/otp-id.value-object.js';
import type { UserId } from '../value-objects/user-id.value-object.js';
import type { Otp } from '../entities/otp.entity.js';

export interface OtpRepository {
  create(otp: Otp): Promise<void>;
  update(otp: Otp): Promise<void>;
  findById(id: OtpId): Promise<Otp | null>;
  /** The one OTP currently valid for this user — there is only ever at most one, by construction of the issuance flow. */
  findActiveByUserId(userId: UserId): Promise<Otp | null>;
}
