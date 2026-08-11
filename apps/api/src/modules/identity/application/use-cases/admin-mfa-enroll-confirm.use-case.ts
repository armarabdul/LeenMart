import type { Clock, Logger } from '@leen-mart/domain-kit';
import { InvalidCredentialsError } from '../../domain/errors/identity-errors.js';
import type { MfaSecretRepository } from '../../domain/repositories/mfa-secret.repository.js';
import type { TotpService } from '../../domain/services/totp.service.js';
import type { MfaSecretCipher } from '../../domain/services/mfa-secret-cipher.service.js';
import type { PasswordHasher } from '../ports/password-hasher.port.js';
import type { UserRepository } from '../ports/user-repository.port.js';
import type { AuthSession, SessionIssuer } from '../services/session-issuer.service.js';

export interface AdminMfaEnrollConfirmInput {
  readonly email: string;
  readonly password: string;
  readonly totpCode: string;
}

export interface AdminMfaEnrollConfirmDeps {
  readonly userRepository: UserRepository;
  readonly passwordHasher: PasswordHasher;
  readonly mfaSecretRepository: MfaSecretRepository;
  readonly totpService: TotpService;
  readonly mfaSecretCipher: MfaSecretCipher;
  readonly sessionIssuer: SessionIssuer;
  readonly clock: Clock;
  readonly logger: Logger;
}

/**
 * Completes admin MFA enrollment: proves possession of the secret
 * `AdminMfaEnrollUseCase` handed back, confirms it, and — since that proves
 * exactly the same two factors a normal login does — issues a full session
 * via the existing `SessionIssuer`, the same as `AdminLoginStepTwoUseCase`.
 * This is the "forced enrollment" completes login in one flow, not two.
 *
 * Re-verifies the password independently rather than trusting anything from
 * the enroll step: nothing here is a session or challenge token, so there is
 * no other proof of identity to build on. Password re-checked before any
 * decrypt/verify work, mirroring step 2's "don't do crypto work for a
 * request that can't succeed" ordering.
 *
 * Every rejection — unknown email, wrong password, non-admin role, no
 * pending (unconfirmed) secret, or wrong TOTP — throws the identical
 * `InvalidCredentialsError` (SEC-15).
 */
export class AdminMfaEnrollConfirmUseCase {
  constructor(private readonly deps: AdminMfaEnrollConfirmDeps) {}

  async execute(input: AdminMfaEnrollConfirmInput): Promise<AuthSession> {
    const {
      userRepository,
      passwordHasher,
      mfaSecretRepository,
      totpService,
      mfaSecretCipher,
      sessionIssuer,
      clock,
      logger,
    } = this.deps;

    const user = await userRepository.findByEmail(input.email);
    if (!user?.passwordHash) {
      logger.warn(
        { email: input.email },
        'Admin MFA enrollment confirmation failed: unknown email',
      );
      throw new InvalidCredentialsError();
    }

    if (!user.role.isAdmin()) {
      logger.warn(
        { userId: user.id },
        'Admin MFA enrollment confirmation refused: non-admin accounts cannot enroll',
      );
      throw new InvalidCredentialsError();
    }

    const passwordValid = await passwordHasher.verify(user.passwordHash, input.password);
    if (!passwordValid) {
      logger.warn({ userId: user.id }, 'Admin MFA enrollment confirmation failed: wrong password');
      throw new InvalidCredentialsError();
    }

    const mfaSecret = await mfaSecretRepository.findByUserId(user.id);
    if (!mfaSecret || mfaSecret.isConfirmed()) {
      logger.warn(
        { userId: user.id },
        'Admin MFA enrollment confirmation refused: no pending enrollment',
      );
      throw new InvalidCredentialsError();
    }

    // Decrypted only for the duration of this call, passed straight to
    // `verify()`, never assigned anywhere it would outlive this scope, never
    // logged.
    const decryptedSecret = mfaSecretCipher.decrypt(mfaSecret.encryptedSecret);
    const now = clock.now();
    const totpValid = await totpService.verify({
      secret: decryptedSecret,
      token: input.totpCode,
      now,
    });
    if (!totpValid) {
      logger.warn({ userId: user.id }, 'Admin MFA enrollment confirmation failed: wrong TOTP code');
      throw new InvalidCredentialsError();
    }

    await mfaSecretRepository.update(mfaSecret.confirm(now));

    logger.info(
      { userId: user.id },
      'Admin MFA enrollment confirmed: secret activated, session issued',
    );
    return sessionIssuer.issueFor(user);
  }
}
