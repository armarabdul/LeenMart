export type VendorStatusName =
  | 'REGISTERED'
  | 'KYC_SUBMITTED'
  | 'KYC_UNDER_REVIEW'
  | 'KYC_REJECTED'
  | 'KYC_APPROVED'
  | 'ACTIVE'
  | 'SUSPENDED'
  | 'TERMINATED';

/**
 * A vendor's onboarding state (SDD 15.1's vendor lifecycle).
 *
 * Deliberately not `UserStatus`: a user account answers
 * PENDING/ACTIVE/SUSPENDED/LOCKED, while a vendor answers a longer
 * KYC-driven question that a user account never asks. Reusing one type for
 * both would make an impossible state (a `LOCKED` vendor, a
 * `KYC_UNDER_REVIEW` user) representable.
 *
 * As with `UserStatus`, this type only represents *which* state — the
 * allowed transitions between them belong to the `VendorProfile` entity.
 */
export class VendorStatus {
  private constructor(public readonly name: VendorStatusName) {}

  static readonly REGISTERED = new VendorStatus('REGISTERED');
  static readonly KYC_SUBMITTED = new VendorStatus('KYC_SUBMITTED');
  static readonly KYC_UNDER_REVIEW = new VendorStatus('KYC_UNDER_REVIEW');
  static readonly KYC_REJECTED = new VendorStatus('KYC_REJECTED');
  static readonly KYC_APPROVED = new VendorStatus('KYC_APPROVED');
  static readonly ACTIVE = new VendorStatus('ACTIVE');
  static readonly SUSPENDED = new VendorStatus('SUSPENDED');
  static readonly TERMINATED = new VendorStatus('TERMINATED');

  private static readonly BY_NAME: Readonly<Record<VendorStatusName, VendorStatus>> = {
    REGISTERED: VendorStatus.REGISTERED,
    KYC_SUBMITTED: VendorStatus.KYC_SUBMITTED,
    KYC_UNDER_REVIEW: VendorStatus.KYC_UNDER_REVIEW,
    KYC_REJECTED: VendorStatus.KYC_REJECTED,
    KYC_APPROVED: VendorStatus.KYC_APPROVED,
    ACTIVE: VendorStatus.ACTIVE,
    SUSPENDED: VendorStatus.SUSPENDED,
    TERMINATED: VendorStatus.TERMINATED,
  };

  static fromName(name: string): VendorStatus {
    const status = (VendorStatus.BY_NAME as Record<string, VendorStatus | undefined>)[name];
    if (!status) {
      throw new TypeError(`Not a valid vendor status: "${name}"`);
    }
    return status;
  }

  equals(other: VendorStatus): boolean {
    return this.name === other.name;
  }
}
