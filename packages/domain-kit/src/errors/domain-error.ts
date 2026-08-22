/**
 * Error taxonomy (SDD 17.1).
 *
 * These types live in the domain layer and know nothing about HTTP. A single
 * mapper in the API's interface layer translates them into status codes and
 * RFC 7807 bodies, which is what keeps the domain transport-agnostic.
 */
export type ErrorKind =
  | 'VALIDATION'
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'DOMAIN_RULE'
  | 'RATE_LIMIT'
  | 'INTEGRATION'
  | 'INTERNAL';

export interface ErrorDetail {
  readonly field?: string;
  readonly issue: string;
}

export interface AppErrorOptions {
  readonly code?: string;
  readonly details?: readonly ErrorDetail[];
  readonly cause?: unknown;
}

export abstract class AppError extends Error {
  abstract readonly kind: ErrorKind;

  /** Stable, machine-readable code the client switches on (SDD 9.3). */
  abstract readonly code: string;

  readonly details: readonly ErrorDetail[];

  constructor(message: string, options: AppErrorOptions = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = new.target.name;
    this.details = options.details ?? [];
    if (typeof Error.captureStackTrace === 'function') {
      Error.captureStackTrace(this, new.target);
    }
  }
}

export class ValidationError extends AppError {
  readonly kind = 'VALIDATION' as const;
  readonly code: string;

  constructor(message = 'The request payload failed validation.', options: AppErrorOptions = {}) {
    super(message, options);
    this.code = options.code ?? 'VALIDATION_FAILED';
  }
}

export class UnauthenticatedError extends AppError {
  readonly kind = 'UNAUTHENTICATED' as const;
  readonly code: string;

  constructor(message = 'Authentication is required.', options: AppErrorOptions = {}) {
    super(message, options);
    this.code = options.code ?? 'UNAUTHENTICATED';
  }
}

export class ForbiddenError extends AppError {
  readonly kind = 'FORBIDDEN' as const;
  readonly code: string;

  constructor(message = 'You do not have access to this resource.', options: AppErrorOptions = {}) {
    super(message, options);
    this.code = options.code ?? 'FORBIDDEN';
  }
}

export class NotFoundError extends AppError {
  readonly kind = 'NOT_FOUND' as const;
  readonly code: string;

  constructor(message = 'The requested resource was not found.', options: AppErrorOptions = {}) {
    super(message, options);
    this.code = options.code ?? 'NOT_FOUND';
  }
}

export class ConflictError extends AppError {
  readonly kind = 'CONFLICT' as const;
  readonly code: string;

  constructor(message: string, options: AppErrorOptions = {}) {
    super(message, options);
    this.code = options.code ?? 'CONFLICT';
  }
}

/** A business rule was violated: valid input, disallowed outcome. */
export class DomainRuleError extends AppError {
  readonly kind = 'DOMAIN_RULE' as const;
  readonly code: string;

  constructor(code: string, message: string, options: AppErrorOptions = {}) {
    super(message, options);
    this.code = code;
  }
}

export class RateLimitError extends AppError {
  readonly kind = 'RATE_LIMIT' as const;
  readonly code = 'RATE_LIMIT_EXCEEDED';
  readonly retryAfterSeconds: number;

  constructor(retryAfterSeconds: number, message = 'Too many requests.') {
    super(message);
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

/** An external dependency failed. Retryable; never leaks provider detail outward. */
export class IntegrationError extends AppError {
  readonly kind = 'INTEGRATION' as const;
  readonly code: string;
  readonly provider: string;

  constructor(provider: string, message: string, options: AppErrorOptions = {}) {
    super(message, options);
    this.provider = provider;
    this.code = options.code ?? 'INTEGRATION_FAILED';
  }
}

export class InternalError extends AppError {
  readonly kind = 'INTERNAL' as const;
  readonly code = 'INTERNAL_ERROR';

  constructor(message = 'An unexpected error occurred.', options: AppErrorOptions = {}) {
    super(message, options);
  }
}

export const isAppError = (error: unknown): error is AppError => error instanceof AppError;
