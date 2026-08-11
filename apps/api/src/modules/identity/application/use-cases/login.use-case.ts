import type { Logger } from '@leen-mart/domain-kit';
import { InvalidCredentialsError } from '../../domain/errors/identity-errors.js';
import type { PasswordHasher } from '../ports/password-hasher.port.js';
import type { UserRepository } from '../ports/user-repository.port.js';
import type { AuthSession, SessionIssuer } from '../services/session-issuer.service.js';

export interface LoginInput {
  readonly email: string;
  readonly password: string;
}

export interface LoginDeps {
  readonly userRepository: UserRepository;
  readonly passwordHasher: PasswordHasher;
  readonly sessionIssuer: SessionIssuer;
  readonly logger: Logger;
}

export class LoginUseCase {
  constructor(private readonly deps: LoginDeps) {}

  async execute(input: LoginInput): Promise<AuthSession> {
    const { userRepository, passwordHasher, sessionIssuer, logger } = this.deps;

    const user = await userRepository.findByEmail(input.email);
    if (!user?.passwordHash) {
      // Covers both an unknown email and a phone-registered account with no
      // password set yet — identical response either way (SEC-15: this must
      // never become an account-enumeration oracle).
      logger.warn({ email: input.email }, 'Login failed: unknown email');
      throw new InvalidCredentialsError();
    }

    // Administrators authenticate on their own surface, where TOTP is
    // mandatory (SDD 7.1). Refusing them here is what stops this endpoint
    // from becoming an MFA bypass. The rejection is deliberately identical
    // to the unknown-email case — telling the caller "this is an admin, use
    // the admin console" would be an account-enumeration oracle (SEC-15) —
    // and it happens before the password is checked, so this surface reveals
    // nothing about an administrator's credentials either.
    if (user.role.isAdmin()) {
      logger.warn({ userId: user.id }, 'Login refused: admin accounts must use the admin surface');
      throw new InvalidCredentialsError();
    }

    const passwordValid = await passwordHasher.verify(user.passwordHash, input.password);
    if (!passwordValid) {
      logger.warn({ userId: user.id }, 'Login failed: wrong password');
      throw new InvalidCredentialsError();
    }

    // Only after the password verifies (SDD 7.2). A suspended account must
    // not be handed a fresh session — revoking the sessions it already had
    // achieves nothing if it can simply log in again. Checking here rather
    // than above the password means a wrong guess still answers
    // `INVALID_CREDENTIALS`, so this never becomes a way to discover which
    // accounts exist and are suspended (SEC-15).
    user.assertCanAuthenticate();

    logger.info({ userId: user.id }, 'Login succeeded');
    return sessionIssuer.issueFor(user);
  }
}
