import type { UserId } from '../value-objects/user-id.value-object.js';
import type { VendorId } from '../value-objects/vendor-id.value-object.js';
import { UserStatus } from '../value-objects/user-status.value-object.js';
import { KycPendingError } from '../errors/identity-errors.js';

export interface VendorProfileProps {
  readonly id: VendorId;
  readonly userId: UserId;
  readonly status: UserStatus;
  readonly kycApprovedAt: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/**
 * Vendor-specific state, kept separate from `User`: KYC approval and a
 * vendor's own activation status apply only to vendors, and every `User`
 * load would otherwise carry fields that mean nothing for a customer or
 * admin. Reuses `UserStatus` rather than a near-identical `VendorStatus` —
 * "which of PENDING/ACTIVE/SUSPENDED/LOCKED is this account in" is the same
 * question for a vendor profile as it is for a user.
 */
export class VendorProfile {
  private constructor(private readonly props: VendorProfileProps) {}

  static create(props: { id: VendorId; userId: UserId; now: Date }): VendorProfile {
    return new VendorProfile({
      id: props.id,
      userId: props.userId,
      status: UserStatus.PENDING,
      kycApprovedAt: null,
      createdAt: props.now,
      updatedAt: props.now,
    });
  }

  static reconstitute(props: VendorProfileProps): VendorProfile {
    return new VendorProfile(props);
  }

  get id(): VendorId {
    return this.props.id;
  }

  get userId(): UserId {
    return this.props.userId;
  }

  get status(): UserStatus {
    return this.props.status;
  }

  get kycApprovedAt(): Date | null {
    return this.props.kycApprovedAt;
  }

  isKycApproved(): boolean {
    return this.props.kycApprovedAt !== null;
  }

  approveKyc(now: Date): VendorProfile {
    return new VendorProfile({ ...this.props, kycApprovedAt: now, updatedAt: now });
  }

  /** The one stated invariant: a vendor cannot become ACTIVE before KYC approval. */
  activate(now: Date): VendorProfile {
    if (!this.isKycApproved()) {
      throw new KycPendingError();
    }
    return new VendorProfile({ ...this.props, status: UserStatus.ACTIVE, updatedAt: now });
  }

  suspend(now: Date): VendorProfile {
    return new VendorProfile({ ...this.props, status: UserStatus.SUSPENDED, updatedAt: now });
  }
}
