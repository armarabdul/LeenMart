import { type AppErrorOptions, DomainRuleError, ValidationError } from '@leen-mart/domain-kit';

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
