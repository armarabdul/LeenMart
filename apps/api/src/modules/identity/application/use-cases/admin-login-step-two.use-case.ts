import type { Clock, Logger } from '@leen-mart/domain-kit';
import { InvalidCredentialsError } from '../../domain/errors/identity-errors.js';
import type { MfaChallengeRepository } from '../../domain/repositories/mfa-challenge.repository.js';
import type { MfaSecretRepository } from '../../domain/repositories/mfa-secret.repository.js';
import type { TokenHasher } from '../../domain/services/token-hasher.service.js';
import type { TotpService } from '../../domain/services/totp.service.js';
import type { MfaSecretCipher } from '../../domain/services/mfa-secret-cipher.service.js';
import type { UserRepository } from '../ports/user-repository.port.js';
import type { AuthSession, SessionIssuer } from '../services/session-issuer.service.js';

export interface AdminLoginStepTwoInput {
  readonly mfaChallengeToken: string;
  readonly totpCode: string;
}

export interface AdminLoginStepTwoDeps {
  readonly userRepository: UserRepository;
  readonly mfaSecretRepository: MfaSecretRepository;
  readonly mfaChallengeRepository: MfaChallengeRepository;
  readonly challengeTokenHasher: TokenHasher;
  readonly totpService: TotpService;
  readonly mfaSecretCipher: MfaSecretCipher;
  readonly sessionIssuer: SessionIssuer;
  readonly clock: Clock;
  readonly logger: Logger;
}

/**
 * Step 2 of admin sign-in (SDD 7.1) — the opaque challenge from step 1 plus
 * a TOTP code. This is the *only* place an admin session is issued; every
 * other path (step 1, a wrong code, a dead challenge) ends in
 * `InvalidCredentialsError` and nothing else.
 *
 * Every rejection — unknown challenge, expired, already consumed, attempts
 * exhausted, wrong TOTP, or a missing/unconfirmed MFA secret — throws the
 * identical `InvalidCredentialsError` (SEC-15 applied at least as strictly
 * as step 1: none of these states is distinguishable from outside). A dead
 * challenge (expired/consumed/exhausted) is rejected *before* any TOTP
 * verification is attempted — no point spending a decrypt + verify on a
 * challenge that can never succeed, and it keeps "wrong code" and "dead
 * challenge" from being distinguishable by timing.
 *
 * Replay/race safety: two requests presenting the same challenge (a genuine
 * replay, or two concurrent requests racing the same still-active
 * challenge) can both pass the in-memory `isActive`/TOTP checks, but only
 * one can win `mfaChallengeRepository.consumeIfActive` — a single atomic
 * conditional database write, not a read-modify-write. The loser gets
 * `false` and fails exactly like any other dead challenge, never reaching
 * `sessionIssuer.issueFor()`. This is what actually prevents one challenge
 * from producing two sessions; the entity's own `isActive()` check alone
 * cannot, since it only reflects what *this* request read.
 */
export class AdminLoginStepTwoUseCase {
  constructor(private readonly deps: AdminLoginStepTwoDeps) {}

  async execute(input: AdminLoginStepTwoInput): Promise<AuthSession> {
    const {
      userRepository,
      mfaSecretRepository,
      mfaChallengeRepository,
      challengeTokenHasher,
      totpService,
      mfaSecretCipher,
      sessionIssuer,
      clock,
      logger,
    } = this.deps;

    const now = clock.now();
    const tokenHash = challengeTokenHasher.hash(input.mfaChallengeToken);
    const challenge = await mfaChallengeRepository.findByTokenHash(tokenHash);
    if (!challenge) {
      logger.warn({}, 'Admin login step 2 failed: unknown MFA challenge');
      throw new InvalidCredentialsError();
    }

    if (!challenge.isActive(now)) {
      logger.warn(
        { userId: challenge.userId },
        'Admin login step 2 failed: challenge expired, consumed, or exhausted',
      );
      throw new InvalidCredentialsError();
    }

    const user = await userRepository.findById(challenge.userId);
    const mfaSecret = user ? await mfaSecretRepository.findByUserId(user.id) : null;
    if (!user || !mfaSecret?.isConfirmed()) {
      logger.warn(
        { userId: challenge.userId },
        'Admin login step 2 failed: no confirmed MFA secret',
      );
      throw new InvalidCredentialsError();
    }

    // Decrypted only for the duration of this call, passed straight to
    // `verify()`, never assigned anywhere it would outlive this scope, never
    // logged.
    const decryptedSecret = mfaSecretCipher.decrypt(mfaSecret.encryptedSecret);
    const totpValid = await totpService.verify({
      secret: decryptedSecret,
      token: input.totpCode,
      now,
    });
    if (!totpValid) {
      await mfaChallengeRepository.update(challenge.recordFailedAttempt(now));
      logger.warn({ userId: user.id }, 'Admin login step 2 failed: wrong TOTP code');
      throw new InvalidCredentialsError();
    }

    const consumed = await mfaChallengeRepository.consumeIfActive(challenge.id, now);
    if (!consumed) {
      logger.warn(
        { userId: user.id },
        'Admin login step 2 failed: challenge already consumed (replay or lost race)',
      );
      throw new InvalidCredentialsError();
    }

    // Only after the TOTP verifies, and deliberately after the challenge has
    // been consumed (SDD 7.2, SEC-15): a shut-out administrator must not be
    // able to replay the same challenge, so it is burned either way.
    user.assertCanAuthenticate();

    logger.info({ userId: user.id }, 'Admin login step 2 succeeded: session issued');
    return sessionIssuer.issueFor(user);
  }
}
