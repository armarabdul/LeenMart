import type { MfaSecretId } from '../value-objects/mfa-secret-id.value-object.js';
import type { UserId } from '../value-objects/user-id.value-object.js';
import type { MfaSecret } from '../entities/mfa-secret.entity.js';

export interface MfaSecretRepository {
  create(mfaSecret: MfaSecret): Promise<void>;
  update(mfaSecret: MfaSecret): Promise<void>;
  findById(id: MfaSecretId): Promise<MfaSecret | null>;
  /** At most one secret per user, enforced by a unique constraint on `userId`. */
  findByUserId(userId: UserId): Promise<MfaSecret | null>;
}
