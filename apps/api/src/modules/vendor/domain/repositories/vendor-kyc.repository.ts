import type { VendorId } from '../../../identity/index.js';
import type { VendorKyc } from '../entities/vendor-kyc.entity.js';
import type { KycId } from '../value-objects/kyc-id.value-object.js';
import type { SensitiveFingerprint } from '../value-objects/sensitive-fingerprint.value-object.js';

/**
 * Persistence for the `VendorKyc` aggregate.
 *
 * **Documents have no repository of their own.** A `KycDocument` is inside
 * this aggregate's boundary — KYC-1 made the document set part of `submit()`
 * and validates its completeness there — so loading or writing one
 * independently would step around the invariant that put it there. They are
 * saved with the submission and returned with it, which is also why `create`
 * has to be atomic.
 *
 * Kept deliberately narrow: five operations, each with a named caller in
 * KYC-4 or KYC-5. There is no `update`, no `delete` and no generic `save` —
 * a submission's identifiers and documents are fixed once written, and the
 * only thing that legitimately changes afterwards is the review.
 */
export interface VendorKycRepository {
  /**
   * Persists a new submission together with its documents, in one
   * transaction. Both or neither: a submission whose documents failed to write
   * would look complete to the aggregate and be unreviewable in practice.
   *
   * Relies on the database for the one-undecided-attempt invariant rather than
   * checking first — two concurrent callers can both pass a check and only one
   * can win a unique index.
   */
  create(kyc: VendorKyc): Promise<void>;

  findById(id: KycId): Promise<VendorKyc | null>;

  /**
   * The vendor's undecided submission, if they have one — "undecided" being
   * exactly the predicate `uq_vendor_kyc_one_undecided` enforces, so this can
   * return at most one row by construction rather than by convention.
   */
  findCurrentByVendorId(vendorId: VendorId): Promise<VendorKyc | null>;

  /** Every attempt by one vendor, newest first. Rejected history stays queryable (SDD 18.4). */
  listByVendorId(vendorId: VendorId): Promise<VendorKyc[]>;

  /**
   * Writes back the review columns only.
   *
   * Narrow on purpose, following `PrismaVendorRepository.update`: the
   * identifiers and documents of a submission are immutable once made, and a
   * repository that rewrote them would give a caller a way to alter what was
   * submitted after a reviewer had already looked at it.
   */
  saveReview(kyc: VendorKyc): Promise<void>;

  /**
   * Submissions sharing a fingerprint with the supplied ones, excluding the
   * vendor's own — the SEC-17 lookup ("Link identities on PAN/bank
   * account/…; block at KYC").
   *
   * Excluding the vendor's own attempts is the whole reason this takes a
   * `vendorId`: a rejected vendor resubmitting necessarily reuses their own
   * PAN, and matching against themselves would make every resubmission look
   * like ban evasion. It is a *lookup*, not a verdict — SDD 16 scores the
   * signal and a human decides (SDD 15.1).
   */
  findByIdentifierFingerprints(input: {
    vendorId: VendorId;
    panFingerprint: SensitiveFingerprint;
    bankFingerprint: SensitiveFingerprint;
  }): Promise<VendorKyc[]>;
}
