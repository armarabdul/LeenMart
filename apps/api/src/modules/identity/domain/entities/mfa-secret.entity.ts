import type { MfaSecretId } from '../value-objects/mfa-secret-id.value-object.js';
import type { UserId } from '../value-objects/user-id.value-object.js';

export interface MfaSecretProps {
  readonly id: MfaSecretId;
  readonly userId: UserId;
  readonly encryptedSecret: string;
  readonly confirmedAt: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/**
 * An administrator's TOTP secret (SDD 7.1: mandatory MFA for every admin
 * role). Holds `encryptedSecret` — ciphertext, never the raw base32 secret —
 * exactly as `Session`/`Otp` hold a hash rather than the raw value they
 * protect. This entity does not encrypt, decrypt, generate, or verify
 * anything: it only carries state. That work belongs to the TOTP service
 * that will consume this entity in a later chunk.
 *
 * One row per user, enforced at the database level (`userId` unique) rather
 * than here, the same as `VendorProfile`.
 */
export class MfaSecret {
  private constructor(private readonly props: MfaSecretProps) {}

  static enroll(props: {
    id: MfaSecretId;
    userId: UserId;
    encryptedSecret: string;
    now: Date;
  }): MfaSecret {
    return new MfaSecret({
      id: props.id,
      userId: props.userId,
      encryptedSecret: props.encryptedSecret,
      confirmedAt: null,
      createdAt: props.now,
      updatedAt: props.now,
    });
  }

  static reconstitute(props: MfaSecretProps): MfaSecret {
    return new MfaSecret(props);
  }

  get id(): MfaSecretId {
    return this.props.id;
  }

  get userId(): UserId {
    return this.props.userId;
  }

  get encryptedSecret(): string {
    return this.props.encryptedSecret;
  }

  get confirmedAt(): Date | null {
    return this.props.confirmedAt;
  }

  get createdAt(): Date {
    return this.props.createdAt;
  }

  get updatedAt(): Date {
    return this.props.updatedAt;
  }

  isConfirmed(): boolean {
    return this.props.confirmedAt !== null;
  }

  confirm(now: Date): MfaSecret {
    return new MfaSecret({ ...this.props, confirmedAt: now, updatedAt: now });
  }
}
