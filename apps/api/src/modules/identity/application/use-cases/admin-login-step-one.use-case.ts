import type { Clock, IdGenerator, Logger } from '@leen-mart/domain-kit';
import { InvalidCredentialsError } from '../../domain/errors/identity-errors.js';
import { MfaChallenge } from '../../domain/entities/mfa-challenge.entity.js';
import { toMfaChallengeId } from '../../domain/value-objects/mfa-challenge-id.value-object.js';
import type { MfaChallengeRepository } from '../../domain/repositories/mfa-challenge.repository.js';
import type { MfaSecretRepository } from '../../domain/repositories/mfa-secret.repository.js';
import type { TokenGenerator } from '../../domain/services/token-generator.service.js';
import type { TokenHasher } from '../../domain/services/token-hasher.service.js';
import type { PasswordHasher } from '../ports/password-hasher.port.js';
import type { UserRepository } from '../ports/user-repository.port.js';

export interface AdminLoginStepOneInput {
  readonly email: string;
  readonly password: string;
}

export interface AdminLoginStepOneResult {
  readonly mfaChallengeToken: string;
  readonly mfaChallengeTokenExpiresAt: Date;
}

export interface AdminLoginStepOneDeps {
  readonly userRepository: UserRepository;
  readonly passwordHasher: PasswordHasher;
  readonly mfaSecretRepository: MfaSecretRepository;
  readonly mfaChallengeRepository: MfaChallengeRepository;
  readonly challengeTokenGenerator: TokenGenerator;
  readonly challengeTokenHasher: TokenHasher;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
  readonly logger: Logger;
}

/**
 * Step 1 of admin sign-in (SDD 7.1: mandatory TOTP, always) — email +
 * password (Argon2id), on success producing only an opaque MFA challenge,
 * never a session. The customer `/api/v1/identity/login` surface already
 * refuses every admin role before checking a password (Milestone 3 Step
 * 5A+5G); this is the inverse guard on the admin surface, refusing every
 * non-admin role before checking one.
 *
 * Every rejection — unknown email, wrong password, non-admin role, or an
 * admin with no confirmed MFA secret — throws the identical
 * `InvalidCredentialsError`, so none of these states is distinguishable from
 * outside (SEC-15). An admin with no confirmed secret is rejected rather
 * than issued a challenge: SDD 7.1 makes TOTP mandatory, always, so there is
 * no such thing as a valid login for an unenrolled admin, and issuing a
 * challenge that step 2 could never satisfy would be a dead end that also
 * leaks enrollment state through a different response shape.
 */
export class AdminLoginStepOneUseCase {
  constructor(private readonly deps: AdminLoginStepOneDeps) {}

  async execute(input: AdminLoginStepOneInput): Promise<AdminLoginStepOneResult> {
    const {
      userRepository,
      passwordHasher,
      mfaSecretRepository,
      mfaChallengeRepository,
      challengeTokenGenerator,
      challengeTokenHasher,
      idGenerator,
      clock,
      logger,
    } = this.deps;

    const user = await userRepository.findByEmail(input.email);
    if (!user?.passwordHash) {
      logger.warn({ email: input.email }, 'Admin login step 1 failed: unknown email');
      throw new InvalidCredentialsError();
    }

    if (!user.role.isAdmin()) {
      logger.warn(
        { userId: user.id },
        'Admin login step 1 refused: non-admin accounts must use their own surface',
      );
      throw new InvalidCredentialsError();
    }

    const passwordValid = await passwordHasher.verify(user.passwordHash, input.password);
    if (!passwordValid) {
      logger.warn({ userId: user.id }, 'Admin login step 1 failed: wrong password');
      throw new InvalidCredentialsError();
    }

    const mfaSecret = await mfaSecretRepository.findByUserId(user.id);
    if (!mfaSecret?.isConfirmed()) {
      logger.warn({ userId: user.id }, 'Admin login step 1 refused: no confirmed MFA secret');
      throw new InvalidCredentialsError();
    }

    const now = clock.now();
    const rawChallengeToken = challengeTokenGenerator.generate();
    const challenge = MfaChallenge.issue({
      id: toMfaChallengeId(idGenerator.generate()),
      userId: user.id,
      tokenHash: challengeTokenHasher.hash(rawChallengeToken),
      now,
    });
    await mfaChallengeRepository.create(challenge);

    logger.info({ userId: user.id }, 'Admin login step 1 succeeded: MFA challenge issued');

    return {
      mfaChallengeToken: rawChallengeToken,
      mfaChallengeTokenExpiresAt: challenge.expiresAt,
    };
  }
}
