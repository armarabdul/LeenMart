import { type AppErrorOptions, ConflictError, UnauthenticatedError } from '@leen-mart/domain-kit';

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
