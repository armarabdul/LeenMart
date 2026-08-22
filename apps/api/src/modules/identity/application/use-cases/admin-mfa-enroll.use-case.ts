import type { Clock, IdGenerator, Logger } from '@leen-mart/domain-kit';
import {
  InvalidCredentialsError,
  MfaSecretAlreadyExistsError,
} from '../../domain/errors/identity-errors.js';
import { MfaSecret } from '../../domain/entities/mfa-secret.entity.js';
import { toMfaSecretId } from '../../domain/value-objects/mfa-secret-id.value-object.js';
import type { MfaSecretRepository } from '../../domain/repositories/mfa-secret.repository.js';
import type { TotpService } from '../../domain/services/totp.service.js';
import type { MfaSecretCipher } from '../../domain/services/mfa-secret-cipher.service.js';
import type { User } from '../../domain/entities/user.entity.js';
import type { PasswordHasher } from '../ports/password-hasher.port.js';
import type { UserRepository } from '../ports/user-repository.port.js';

export interface AdminMfaEnrollInput {
  readonly email: string;
  readonly password: string;
}

export interface AdminMfaEnrollResult {
  /** Shown to the caller exactly this once — never persisted or returned again. */
  readonly secret: string;
  readonly otpauthUri: string;
}

export interface AdminMfaEnrollDeps {
  readonly userRepository: UserRepository;
  readonly passwordHasher: PasswordHasher;
  readonly mfaSecretRepository: MfaSecretRepository;
  readonly totpService: TotpService;
  readonly mfaSecretCipher: MfaSecretCipher;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
  /** The `otpauth://` URI's issuer label — the same value already used as the JWT issuer. */
  readonly issuer: string;
  readonly logger: Logger;
}

/**
 * Starts admin MFA enrollment (SDD 7.1: mandatory TOTP, always — this is how
 * an admin first acquires the factor login already requires). Produces an
 * *unconfirmed* `MfaSecret`; `AdminMfaEnrollConfirmUseCase` is the only path
 * that activates it. First-time enrollment only — an admin who already has
 * a secret (confirmed or not) is refused, uniformly, the same as any other
 * failure here. Rotation/reset is a distinct, out-of-scope operation.
 *
 * Every rejection — unknown email, wrong password, non-admin role, or a
 * secret that already exists — throws the identical `InvalidCredentialsError`
 * (SEC-15): none of these states is distinguishable from outside.
 */
export class AdminMfaEnrollUseCase {
  constructor(private readonly deps: AdminMfaEnrollDeps) {}

  private async fetchAndValidateAdmin(input: AdminMfaEnrollInput): Promise<User> {
    const { userRepository, passwordHasher, mfaSecretRepository, logger } = this.deps;

    const user = await userRepository.findByEmail(input.email);
    if (!user?.passwordHash) {
      logger.warn({ email: input.email }, 'Admin MFA enrollment failed: unknown email');
      throw new InvalidCredentialsError();
    }

    if (!user.role.isAdmin()) {
      logger.warn(
        { userId: user.id },
        'Admin MFA enrollment refused: non-admin accounts cannot enroll',
      );
      throw new InvalidCredentialsError();
    }

    const passwordValid = await passwordHasher.verify(user.passwordHash, input.password);
    if (!passwordValid) {
      logger.warn({ userId: user.id }, 'Admin MFA enrollment failed: wrong password');
      throw new InvalidCredentialsError();
    }

    const existing = await mfaSecretRepository.findByUserId(user.id);
    if (existing) {
      logger.warn({ userId: user.id }, 'Admin MFA enrollment refused: a secret already exists');
      throw new InvalidCredentialsError();
    }

    return user;
  }

  async execute(input: AdminMfaEnrollInput): Promise<AdminMfaEnrollResult> {
    const {
      mfaSecretRepository,
      totpService,
      mfaSecretCipher,
      idGenerator,
      clock,
      issuer,
      logger,
    } = this.deps;

    const user = await this.fetchAndValidateAdmin(input);

    const now = clock.now();
    const rawSecret = totpService.generateSecret();
    const mfaSecret = MfaSecret.enroll({
      id: toMfaSecretId(idGenerator.generate()),
      userId: user.id,
      encryptedSecret: mfaSecretCipher.encrypt(rawSecret),
      now,
    });

    try {
      await mfaSecretRepository.create(mfaSecret);
    } catch (error) {
      if (error instanceof MfaSecretAlreadyExistsError) {
        logger.warn(
          { userId: user.id },
          'Admin MFA enrollment lost a race: a secret already exists',
        );
        throw new InvalidCredentialsError();
      }
      throw error;
    }

    const otpauthUri = totpService.generateEnrollmentUri({
      secret: rawSecret,
      accountLabel: input.email,
      issuer,
    });

    logger.info({ userId: user.id }, 'Admin MFA enrollment started: unconfirmed secret created');

    return { secret: rawSecret, otpauthUri };
  }
}
