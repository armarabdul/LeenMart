import type { UserId, VendorId } from '../../../identity/index.js';
import { IncompleteKycSubmissionError, InvalidKycOperationError } from '../errors/kyc-errors.js';
import type { KycDocument } from './kyc-document.entity.js';
import type { KycId } from '../value-objects/kyc-id.value-object.js';
import { KycDocumentType } from '../value-objects/kyc-document-type.value-object.js';
import type { KycRejectionReason } from '../value-objects/kyc-rejection-reason.value-object.js';
import type { SensitiveFingerprint } from '../value-objects/sensitive-fingerprint.value-object.js';

/**
 * What survives of a vendor's identifiers once they reach persistence: a
 * one-way fingerprint for SEC-17 duplicate detection, and the last four
 * characters SDD 12.3 displays by default.
 *
 * The full PAN and account number are **not** here and never will be — they
 * exist inside the client-encrypted documents in object storage. `Pan` and
 * `BankAccount` are the value objects that hold them briefly, at the boundary,
 * long enough to be validated and reduced to this.
 *
 * GSTIN is the exception, stored whole, because BR-13 requires it whole — it
 * is filed in GSTR-8 and printed on every tax invoice, and a fingerprint can
 * be neither. That has a consequence worth stating rather than discovering:
 * characters 3–12 of a GSTIN *are* the holder's PAN, so for a GST-registered
 * vendor the PAN is disclosed to anyone who can read this row, and
 * fingerprinting it buys no confidentiality against a database compromise. It
 * still does two things — it protects vendors with no GSTIN, and it keeps the
 * PAN out of every log line and error that would otherwise carry it. This is a
 * property of data the law requires be stored in full, not an argument for
 * storing a second plaintext copy.
 */
export interface KycIdentifiers {
  readonly panFingerprint: SensitiveFingerprint;
  readonly panLast4: string;
  readonly gstin: string;
  readonly bankFingerprint: SensitiveFingerprint;
  readonly bankAccountLast4: string;
  readonly ifsc: string;
}

/**
 * The review of one submission, and its outcome (SDD 15.1: "a human makes the
 * decision and their identity is recorded").
 *
 * `reviewedBy` and `decidedBy` are separate because they answer different
 * questions: who picked the submission up, and who actually decided it. They
 * are usually the same person and are deliberately **not required** to be —
 * the alternative is a submission stranded behind whoever claimed it before
 * going on leave, and reassignment is a workflow the SDD does not define.
 * Recording both means the audit trail stays truthful either way, without
 * inventing a policy to keep it so.
 *
 * `decidedBy` and `decidedAt` move together: null before a decision, both set
 * at the moment of one, and never changed after.
 */
export interface KycReview {
  readonly reviewedBy: UserId;
  readonly startedAt: Date;
  readonly decidedBy: UserId | null;
  readonly decidedAt: Date | null;
  readonly rejectionReason: KycRejectionReason | null;
  readonly rejectionNote: string | null;
}

export interface VendorKycProps {
  readonly id: KycId;
  readonly vendorId: VendorId;
  readonly identifiers: KycIdentifiers;
  readonly documents: readonly KycDocument[];
  readonly review: KycReview | null;
  readonly submittedAt: Date;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/**
 * One KYC submission by one vendor.
 *
 * **This aggregate deliberately carries no status of its own.** The lifecycle
 * SDD 15.1 draws — `KYC_SUBMITTED → KYC_UNDER_REVIEW → {KYC_APPROVED,
 * KYC_REJECTED} → ACTIVE` — already lives on `VendorProfile`, whose transition
 * table enforces it and whose tests cover every legal and illegal edge. A
 * second copy here would be two sources of truth for one fact, and the first
 * bug would be the two disagreeing. What this aggregate owns is everything the
 * status cannot express: which identifiers were given, which documents back
 * them, and who decided what.
 *
 * The pairing is deliberate and one-directional: this entity refuses
 * operations that its own recorded review makes impossible (deciding twice,
 * editing after a claim), while `VendorProfile` refuses transitions that its
 * status makes impossible. Neither reaches into the other; the use case that
 * owns both, in KYC-4/KYC-5, is where they meet.
 *
 * A rejection is not edited into an approval — SDD 15.1 sends a rejected
 * vendor back through `(resubmit)`, which produces a *new* submission via
 * `submit()`. That is what keeps the audit trail of a rejected attempt intact.
 *
 * **Invariant: a vendor has many submissions over time, but at most one that
 * is not yet decided.** The SDD does not state this directly; it follows from
 * `VendorProfile`'s transition table, which is the smallest place it can be
 * enforced without adding state. `SUBMIT_KYC` is reachable only `from`
 * `REGISTERED` or `KYC_REJECTED`, and it lands on `KYC_SUBMITTED` — so a
 * vendor whose submission is still in flight cannot submit again, and a second
 * concurrent submission is refused by the status machine, not by a rule
 * invented here.
 *
 * The consequences for the chunks that follow, recorded so they are not
 * re-derived: the *current* submission is the undecided one; every other is
 * history, ordered by `submittedAt`. Nothing reads "the latest" to decide
 * anything — a reviewer acts on the `KycId` they were shown, so approval
 * applies to the submission that was actually read rather than to whichever
 * row happens to sort last. KYC-2 makes the invariant true rather than merely
 * intended, with a partial unique index on the undecided rows, the same device
 * `idx_addresses_one_default_per_user` already uses for one-of-many.
 */
export class VendorKyc {
  private constructor(private readonly props: VendorKycProps) {}

  /**
   * A vendor's submission. Reached from `REGISTERED` on a first attempt and
   * from `KYC_REJECTED` on a resubmission — both are the same act, and SDD
   * 15.1's `SUBMIT_KYC` transition already allows exactly those two origins.
   */
  static submit(props: {
    id: KycId;
    vendorId: VendorId;
    identifiers: KycIdentifiers;
    documents: readonly KycDocument[];
    now: Date;
  }): VendorKyc {
    VendorKyc.assertDocumentSetIsComplete(props.documents);

    return new VendorKyc({
      id: props.id,
      vendorId: props.vendorId,
      identifiers: props.identifiers,
      documents: props.documents,
      review: null,
      submittedAt: props.now,
      createdAt: props.now,
      updatedAt: props.now,
    });
  }

  static reconstitute(props: VendorKycProps): VendorKyc {
    return new VendorKyc(props);
  }

  /**
   * Every required type present, uploaded, and none of them twice.
   *
   * Checked at submission rather than at review because a reviewer's time is
   * the scarce resource SDD 15.2 worries about: a submission that was always
   * going to be refused for a missing document should never reach the queue.
   */
  private static assertDocumentSetIsComplete(documents: readonly KycDocument[]): void {
    const present = documents.map((document) => document.type.name);

    if (new Set(present).size !== present.length) {
      throw new IncompleteKycSubmissionError('each document type may be supplied only once');
    }
    for (const required of KycDocumentType.REQUIRED) {
      if (!present.includes(required.name)) {
        throw new IncompleteKycSubmissionError(`a ${required.name} document is required`);
      }
    }
    const pending = documents.filter((document) => !document.isUploaded());
    if (pending.length > 0) {
      throw new IncompleteKycSubmissionError(
        'every document must finish uploading before submission',
      );
    }
  }

  /**
   * An administrator claims the submission for review (SDD 15.1's
   * `START_KYC_REVIEW`).
   *
   * Explicit rather than implicit precisely so `reviewedBy` has a value to
   * record: SDD 15.1 requires the deciding human's "identity is recorded", and
   * a review that began by itself has nobody to name.
   */
  startReview(reviewedBy: UserId, now: Date): VendorKyc {
    if (this.props.review) {
      throw new InvalidKycOperationError(
        'startReview',
        this.isDecided()
          ? 'this submission has already been decided'
          : 'this submission is already under review',
      );
    }

    return new VendorKyc({
      ...this.props,
      review: {
        reviewedBy,
        startedAt: now,
        decidedBy: null,
        decidedAt: null,
        rejectionReason: null,
        rejectionNote: null,
      },
      updatedAt: now,
    });
  }

  /**
   * `decidedBy` is the administrator performing *this* call, not the one who
   * claimed the review — SDD 15.1 records the identity of the human who made
   * the decision, and when the two differ it is the decider that sentence
   * means.
   */
  approve(decidedBy: UserId, now: Date): VendorKyc {
    const review = this.assertDecidable('approve');

    return new VendorKyc({
      ...this.props,
      review: { ...review, decidedBy, decidedAt: now },
      updatedAt: now,
    });
  }

  /**
   * Refuses the submission with a structured reason and optional free text.
   *
   * `OTHER` is the one reason that must be explained — on its own it tells the
   * vendor nothing they can act on, and a rejection they cannot act on is a
   * vendor who resubmits the same thing.
   *
   * `decidedBy` carries the same meaning it does on `approve`.
   */
  reject(decidedBy: UserId, reason: KycRejectionReason, note: string | null, now: Date): VendorKyc {
    const review = this.assertDecidable('reject');

    const trimmed = note?.trim() ?? null;
    const explanation = trimmed && trimmed.length > 0 ? trimmed : null;
    if (reason.requiresExplanation() && !explanation) {
      throw new InvalidKycOperationError(
        'reject',
        'a rejection of OTHER must carry an explanation',
      );
    }

    return new VendorKyc({
      ...this.props,
      review: {
        ...review,
        decidedBy,
        decidedAt: now,
        rejectionReason: reason,
        rejectionNote: explanation,
      },
      updatedAt: now,
    });
  }

  /** A decision needs a claimed review, and a review may only be decided once. */
  private assertDecidable(operation: string): KycReview {
    const { review } = this.props;
    if (!review) {
      throw new InvalidKycOperationError(
        operation,
        'this submission has not been claimed for review',
      );
    }
    if (review.decidedAt) {
      throw new InvalidKycOperationError(operation, 'this submission has already been decided');
    }
    return review;
  }

  get id(): KycId {
    return this.props.id;
  }

  get vendorId(): VendorId {
    return this.props.vendorId;
  }

  get identifiers(): KycIdentifiers {
    return this.props.identifiers;
  }

  get documents(): readonly KycDocument[] {
    return this.props.documents;
  }

  get review(): KycReview | null {
    return this.props.review;
  }

  get submittedAt(): Date {
    return this.props.submittedAt;
  }

  get createdAt(): Date {
    return this.props.createdAt;
  }

  get updatedAt(): Date {
    return this.props.updatedAt;
  }

  isUnderReview(): boolean {
    return this.props.review !== null && this.props.review.decidedAt === null;
  }

  isDecided(): boolean {
    return this.props.review?.decidedAt != null;
  }

  isRejected(): boolean {
    return this.isDecided() && this.props.review?.rejectionReason != null;
  }

  isApproved(): boolean {
    return this.isDecided() && this.props.review?.rejectionReason == null;
  }

  /**
   * The safe shape, for the same reason `KycDocument` has one — and with the
   * fingerprints omitted as well. They are one-way, but they are still the
   * comparison keys for SEC-17 linkage, and a log line full of them would let
   * anyone holding it correlate vendors without ever seeing a PAN.
   */
  toJSON(): Record<string, unknown> {
    return {
      id: this.props.id,
      vendorId: this.props.vendorId,
      identifiers: {
        panLast4: this.props.identifiers.panLast4,
        gstin: this.props.identifiers.gstin,
        bankAccountLast4: this.props.identifiers.bankAccountLast4,
        ifsc: this.props.identifiers.ifsc,
        panFingerprint: '[REDACTED]',
        bankFingerprint: '[REDACTED]',
      },
      documents: this.props.documents.map((document) => document.toJSON()),
      review: this.props.review
        ? {
            reviewedBy: this.props.review.reviewedBy,
            startedAt: this.props.review.startedAt,
            decidedBy: this.props.review.decidedBy,
            decidedAt: this.props.review.decidedAt,
            rejectionReason: this.props.review.rejectionReason?.name ?? null,
            rejectionNote: this.props.review.rejectionNote,
          }
        : null,
      submittedAt: this.props.submittedAt,
      createdAt: this.props.createdAt,
      updatedAt: this.props.updatedAt,
    };
  }
}
