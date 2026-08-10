import type { UserId, VendorId } from '../../../identity/index.js';
import { VendorStatus } from '../value-objects/vendor-status.value-object.js';

export interface VendorProfileProps {
  readonly id: VendorId;
  readonly userId: UserId;
  readonly status: VendorStatus;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/**
 * A vendor's onboarding record (SDD 15.1), kept separate from `User`: KYC
 * state and the vendor lifecycle apply only to vendors, and every `User`
 * load would otherwise carry fields that mean nothing for a customer or
 * admin. `userId` is the link back to the authenticated account that
 * registered (SDD 6.7 permits a foreign key to `users`).
 *
 * Only registration is modelled here. The rest of SDD 15.1's machine
 * (KYC submission, review, approval, activation, suspension, termination)
 * is deliberately absent until the chunk that implements it — a transition
 * with no caller is an untested claim about behaviour we have not built.
 */
export class VendorProfile {
  private constructor(private readonly props: VendorProfileProps) {}

  /** Entry point of SDD 15.1's lifecycle: a new vendor always starts REGISTERED. */
  static register(props: { id: VendorId; userId: UserId; now: Date }): VendorProfile {
    return new VendorProfile({
      id: props.id,
      userId: props.userId,
      status: VendorStatus.REGISTERED,
      createdAt: props.now,
      updatedAt: props.now,
    });
  }

  /** Rehydrates from persisted state. Never applies registration defaults. */
  static reconstitute(props: VendorProfileProps): VendorProfile {
    return new VendorProfile(props);
  }

  get id(): VendorId {
    return this.props.id;
  }

  get userId(): UserId {
    return this.props.userId;
  }

  get status(): VendorStatus {
    return this.props.status;
  }

  get createdAt(): Date {
    return this.props.createdAt;
  }

  get updatedAt(): Date {
    return this.props.updatedAt;
  }
}
