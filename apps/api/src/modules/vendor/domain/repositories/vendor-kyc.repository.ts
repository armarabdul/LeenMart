import type { TransactionScope } from '@leen-mart/domain-kit';
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
   * Re-binds this repository to a transaction the caller already opened. See
   * `UserRepository.withTransaction` and `VendorRepository.withTransaction`,
   * which this mirrors.
   *
   * Exists because submitting KYC is two writes in two repositories — the
   * submission with its documents here, and the `VendorProfile`'s
   * `REGISTERED → KYC_SUBMITTED` transition next door — and a crash between
   * them strands the vendor. Persisting the submission while the profile stays
   * `REGISTERED` leaves an undecided row the vendor cannot see and cannot
   * replace: their retry mints fresh intents happily and then loses to
   * `uq_vendor_kyc_one_undecided`. Doing it the other way round is worse — a
   * profile stuck at `KYC_SUBMITTED` with nothing to review can never
   * transition again, because `submitKyc()` only accepts `REGISTERED` or
   * `KYC_REJECTED`.
   *
   * The scoped instance runs **on the caller's connection** and opens no
   * transaction of its own. That is not an optimisation: a nested
   * `$transaction` would acquire a different connection, one without the
   * `app.vendor_id` the outer transaction set, and RLS would answer with zero
   * rows instead of an error (see `tenant-prisma.ts`).
   */
  withTransaction(scope: TransactionScope): VendorKycRepository;

  /**
   * Persists a new submission together with its documents, in one
   * transaction. Both or neither: a submission whose documents failed to write
   * would look complete to the aggregate and be unreviewable in practice.
   *
   * Opens that transaction itself when called on an unscoped repository, and
   * joins the caller's when called on one from `withTransaction` — the
   * atomicity guarantee is the same either way, only its boundary moves.
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
   * Records a reviewer's claim, but only if nobody else already holds it.
   *
   * Returns whether *this* call was the one that won. A plain `saveReview`
   * cannot answer that: it updates by primary key, so two admins claiming the
   * same submission both succeed and the later write silently becomes the
   * recorded reviewer. The condition lives in the `WHERE` clause for the same
   * reason `MfaChallengeRepository.consumeIfActive` puts it there — a
   * read-then-write cannot arbitrate a race, because both racers read the same
   * unclaimed row before either writes.
   *
   * `false` means someone else claimed it first. It is not an error here; the
   * caller decides what to do about it.
   */
  claimForReviewIfUnclaimed(kyc: VendorKyc): Promise<boolean>;

  /**
   * Records a decision, but only if none has been recorded yet.
   *
   * The arbiter of concurrent approve/reject. Same reasoning as the claim
   * above, and the reason this exists rather than `saveReview` being made
   * conditional: `saveReview` is KYC-2A's published contract and the
   * submission path depends on it staying exactly as it is.
   *
   * Callers must run this inside the same transaction as the vendor's
   * lifecycle transition, so that a failure after the decision is recorded
   * rolls the decision back rather than leaving a decided submission beside an
   * untransitioned vendor.
   */
  saveDecisionIfUndecided(kyc: VendorKyc): Promise<boolean>;

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
   *
   * **This is the one operation here that must NOT run on the vendor-scoped
   * client.** It searches across tenants by design, and the KYC-2B-3 policies
   * correctly refuse that — a vendor-scoped caller gets zero rows, with no
   * error and nothing failing, which is ban-evasion detection silently
   * switched off. It belongs on the `leenmart_admin` credential
   * (`adminPrisma`), behind an authorisation decision made in the interface
   * layer (SDD 7.4).
   *
   * Deliberately unwired for now: it has no production caller, and giving it
   * one is KYC-4/KYC-5's job together with the authorisation that must sit in
   * front of it. A unit test asserts it stays uncalled until then.
   */
  findByIdentifierFingerprints(input: {
    vendorId: VendorId;
    panFingerprint: SensitiveFingerprint;
    bankFingerprint: SensitiveFingerprint;
  }): Promise<VendorKyc[]>;
}
