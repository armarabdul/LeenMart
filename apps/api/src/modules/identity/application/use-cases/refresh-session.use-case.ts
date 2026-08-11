import type { Clock, Logger } from '@leen-mart/domain-kit';
import { InvalidRefreshTokenError } from '../../domain/errors/identity-errors.js';
import type { RefreshTokenHasher } from '../ports/refresh-token-hasher.port.js';
import type { RefreshTokenRepository } from '../ports/refresh-token-repository.port.js';
import type { UserRepository } from '../ports/user-repository.port.js';
import type { AuthSession, SessionIssuer } from '../services/session-issuer.service.js';

export interface RefreshSessionInput {
  readonly refreshToken: string;
}

export interface RefreshSessionDeps {
  readonly userRepository: UserRepository;
  readonly refreshTokenRepository: RefreshTokenRepository;
  readonly refreshTokenHasher: RefreshTokenHasher;
  readonly sessionIssuer: SessionIssuer;
  readonly clock: Clock;
  readonly logger: Logger;
}

/**
 * Exchanges a valid refresh token for a new access + refresh pair, rotating
 * the old token in the same step. A caller that presents a token which was
 * already rotated (or revoked, or expired) is rejected identically — the
 * client cannot distinguish "stolen and already used" from "just expired".
 *
 * Rejection alone is not enough for a token that was *rotated away*. SDD 7.2:
 * presenting one is "definitionally a stolen token", because the legitimate
 * holder already exchanged it and holds the replacement — so **the entire
 * session family is revoked**. Without that, a thief who refreshes before the
 * victim keeps a live family of their own, and the victim's later rejection
 * changes nothing: the compromise is permanent rather than bounded, which is
 * the exact outcome rotation exists to prevent.
 *
 * The response is deliberately unchanged by any of this. Every failure path
 * still throws the same `InvalidRefreshTokenError`, so an attacker probing
 * with a stolen token cannot tell from the reply whether they tripped the
 * detection (SEC-15).
 */
export class RefreshSessionUseCase {
  constructor(private readonly deps: RefreshSessionDeps) {}

  async execute(input: RefreshSessionInput): Promise<AuthSession> {
    const {
      userRepository,
      refreshTokenRepository,
      refreshTokenHasher,
      sessionIssuer,
      clock,
      logger,
    } = this.deps;

    const tokenHash = refreshTokenHasher.hash(input.refreshToken);
    const existing = await refreshTokenRepository.findByTokenHash(tokenHash);
    const now = clock.now();

    if (!existing?.isActive(now)) {
      // `wasRotatedAway()`, not `isRevoked()`: a logout-revoked token carries
      // no replacement and means a stale client, while an expired one means
      // nothing at all. Treating either as theft would revoke a family every
      // time someone double-tapped logout.
      if (existing?.wasRotatedAway()) {
        const revokedCount = await refreshTokenRepository.revokeFamily(existing.familyId, now);
        logger.warn(
          {
            userId: existing.userId,
            tokenId: existing.id,
            familyId: existing.familyId,
            revokedCount,
          },
          'Refresh token reuse detected: session family revoked (SDD 7.2)',
        );
      }
      throw new InvalidRefreshTokenError();
    }

    const user = await userRepository.findById(existing.userId);
    if (!user) {
      throw new InvalidRefreshTokenError();
    }

    // The new session continues this lineage rather than starting one, so a
    // reuse detected many rotations from now still reaches every descendant.
    const session = await sessionIssuer.issueFor(user, existing.familyId);
    await refreshTokenRepository.update(existing.revoke(now, session.refreshTokenId));

    logger.info(
      {
        userId: user.id,
        rotatedTokenId: existing.id,
        newTokenId: session.refreshTokenId,
        familyId: session.refreshTokenFamilyId,
      },
      'Refresh token rotated',
    );
    return session;
  }
}
