import {
  type AppErrorOptions,
  ConflictError,
  DomainRuleError,
  ForbiddenError,
  UnauthenticatedError,
  ValidationError,
} from '@leen-mart/domain-kit';

export class EmailAlreadyRegisteredError extends ConflictError {
  constructor(options: AppErrorOptions = {}) {
    super('An account with this email address already exists.', {
      ...options,
      code: 'EMAIL_ALREADY_REGISTERED',
    });
  }
}

/**
 * Deliberately identical whether the email is unknown or the password is
 * wrong — a distinct message for "unknown email" turns login into an account
 * enumeration oracle.
 */
export class InvalidCredentialsError extends UnauthenticatedError {
  constructor(options: AppErrorOptions = {}) {
    super('Invalid email or password.', { ...options, code: 'INVALID_CREDENTIALS' });
  }
}

export class InvalidRefreshTokenError extends UnauthenticatedError {
  constructor(options: AppErrorOptions = {}) {
    super('The refresh token is invalid, expired or has already been used.', {
      ...options,
      code: 'INVALID_REFRESH_TOKEN',
    });
  }
}

export class InvalidEmailError extends ValidationError {
  constructor(options: AppErrorOptions = {}) {
    super('The provided value is not a valid email address.', { ...options, code: 'INVALID_EMAIL' });
  }
}

export class InvalidPhoneError extends ValidationError {
  constructor(options: AppErrorOptions = {}) {
    super('The provided value is not a valid phone number.', { ...options, code: 'INVALID_PHONE' });
  }
}

export class InvalidOtpError extends ValidationError {
  constructor(options: AppErrorOptions = {}) {
    super('The provided OTP code is invalid.', { ...options, code: 'INVALID_OTP' });
  }
}

/** The OTP existed and was well-formed, but its 5-minute validity window has passed. */
export class ExpiredOtpError extends UnauthenticatedError {
  constructor(options: AppErrorOptions = {}) {
    super('This OTP has expired.', { ...options, code: 'EXPIRED_OTP' });
  }
}

export class DuplicateEmailError extends ConflictError {
  constructor(options: AppErrorOptions = {}) {
    super('An account with this email address already exists.', {
      ...options,
      code: 'DUPLICATE_EMAIL',
    });
  }
}

export class DuplicatePhoneError extends ConflictError {
  constructor(options: AppErrorOptions = {}) {
    super('An account with this phone number already exists.', {
      ...options,
      code: 'DUPLICATE_PHONE',
    });
  }
}

export class AccountLockedError extends ForbiddenError {
  constructor(options: AppErrorOptions = {}) {
    super('This account is locked.', { ...options, code: 'ACCOUNT_LOCKED' });
  }
}

export class AccountSuspendedError extends ForbiddenError {
  constructor(options: AppErrorOptions = {}) {
    super('This account has been suspended.', { ...options, code: 'ACCOUNT_SUSPENDED' });
  }
}

/** Rejects a malformed or empty password hash — never a plaintext-password complaint (SDD 6.1: hashing is infrastructure's job). */
export class InvalidPasswordError extends ValidationError {
  constructor(options: AppErrorOptions = {}) {
    super('The provided value is not a valid password hash.', { ...options, code: 'INVALID_PASSWORD' });
  }
}

/** Known identity, insufficient permission — distinct from UnauthenticatedError ("who are you?"). */
export class UnauthorizedError extends ForbiddenError {
  constructor(options: AppErrorOptions = {}) {
    super('You are not authorized to perform this action.', { ...options, code: 'UNAUTHORIZED' });
  }
}

/** A valid action, blocked by an unmet business rule — a vendor cannot become ACTIVE before KYC approval. */
export class KycPendingError extends DomainRuleError {
  constructor(options: AppErrorOptions = {}) {
    super('VENDOR_KYC_PENDING', 'This vendor cannot become active until KYC has been approved.', options);
  }
}
