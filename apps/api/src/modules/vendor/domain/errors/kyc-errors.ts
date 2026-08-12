import {
  type AppErrorOptions,
  ConflictError,
  DomainRuleError,
  NotFoundError,
  ValidationError,
} from '@leen-mart/domain-kit';

/**
 * A supplied identifier is not the shape it claims to be.
 *
 * The message names the *field*, never the value. A rejected PAN or account
 * number is still a real one, and echoing it back would put it into the error
 * envelope, the client's console and any log line that records the failure.
 */
export class InvalidKycIdentifierError extends ValidationError {
  constructor(field: string, issue: string, options: AppErrorOptions = {}) {
    super('This identifier is not valid.', {
      ...options,
      code: 'INVALID_KYC_IDENTIFIER',
      details: [{ field, issue }],
    });
  }
}

/** A document type outside SDD 15.1's V1 set (PAN, bank account proof, GSTIN). */
export class UnsupportedKycDocumentTypeError extends ValidationError {
  constructor(options: AppErrorOptions = {}) {
    super('This document type is not accepted.', {
      ...options,
      code: 'UNSUPPORTED_KYC_DOCUMENT_TYPE',
    });
  }
}

/**
 * A submission is missing a document SDD 15.1 requires, or carries the same
 * type twice. A `DomainRuleError` rather than a validation failure: every
 * individual field was well-formed, and it is the *set* that is wrong.
 */
export class IncompleteKycSubmissionError extends DomainRuleError {
  constructor(issue: string, options: AppErrorOptions = {}) {
    super('INCOMPLETE_KYC_SUBMISSION', 'This KYC submission is incomplete.', {
      ...options,
      details: [{ field: 'documents', issue }],
    });
  }
}

/**
 * An operation asked of a KYC record in a state that does not permit it —
 * editing a submission under review, deciding one that was never claimed,
 * revisiting a decision already made.
 *
 * Names both the current state and the attempted action, mirroring
 * `InvalidVendorStatusTransitionError`'s "X → Y is not a permitted
 * transition" so a caller can tell what was refused rather than only that
 * something was.
 */
export class InvalidKycOperationError extends DomainRuleError {
  constructor(operation: string, issue: string, options: AppErrorOptions = {}) {
    super(
      'INVALID_KYC_OPERATION',
      'This action is not permitted for the KYC record in its current state.',
      {
        ...options,
        details: [{ field: operation, issue }],
      },
    );
  }
}

/**
 * No KYC submission exists with the requested id.
 *
 * A plain 404 with no distinction between "never existed" and "exists but you
 * may not see it". Only an administrator holding
 * `APPROVE_OR_REJECT_VENDOR_KYC` reaches the lookup at all, and their SELECT
 * policy spans every vendor — so for this caller the two cases genuinely are
 * the same case, and a narrower message would only describe the id back to
 * whoever guessed it.
 */
export class KycSubmissionNotFoundError extends NotFoundError {
  constructor(options: AppErrorOptions = {}) {
    super('No KYC submission was found.', { ...options, code: 'KYC_SUBMISSION_NOT_FOUND' });
  }
}

/**
 * Another reviewer claimed this submission first.
 *
 * A `ConflictError` rather than a `DomainRuleError`: the caller did nothing
 * wrong and the request was well formed — the state simply changed underneath
 * them, which is what 409 means. Mirrors `VendorAlreadyRegisteredError`, the
 * other "someone got there first" case in this module.
 *
 * Names no reviewer. Which colleague holds it is visible in the queue to
 * anyone entitled to see it, and putting it in an error message would put it
 * in every client log that captured the failure.
 */
export class KycReviewAlreadyClaimedError extends ConflictError {
  constructor(options: AppErrorOptions = {}) {
    super('This KYC submission is already under review by another reviewer.', {
      ...options,
      code: 'KYC_REVIEW_ALREADY_CLAIMED',
    });
  }
}

/**
 * The submission was decided by someone else between this reviewer loading it
 * and deciding it.
 *
 * Distinct from `InvalidKycOperationError`, which the aggregate raises when
 * the *loaded* state already forbids the operation. This one is the race the
 * aggregate cannot see: both reviewers loaded an undecided submission, and
 * only one conditional update could win.
 */
export class KycAlreadyDecidedError extends ConflictError {
  constructor(options: AppErrorOptions = {}) {
    super('This KYC submission has already been decided.', {
      ...options,
      code: 'KYC_ALREADY_DECIDED',
    });
  }
}
