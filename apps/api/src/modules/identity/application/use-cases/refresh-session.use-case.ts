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
 */
export class RefreshSessionUseCase {
  constructor(private readonly deps: RefreshSessionDeps) {}

  async execute(input: RefreshSessionInput): Promise<AuthSession> {
    const { userRepository, refreshTokenRepository, refreshTokenHasher, sessionIssuer, clock, logger } = this.deps;

    const tokenHash = refreshTokenHasher.hash(input.refreshToken);
    const existing = await refreshTokenRepository.findByTokenHash(tokenHash);
    const now = clock.now();

    if (!existing?.isActive(now)) {
      if (existing?.isRevoked()) {
        logger.warn({ tokenId: existing.id }, 'Rejected reuse of a rotated or revoked refresh token');
      }
      throw new InvalidRefreshTokenError();
    }

    const user = await userRepository.findById(existing.userId);
    if (!user) {
      throw new InvalidRefreshTokenError();
    }

    const session = await sessionIssuer.issueFor(user);
    await refreshTokenRepository.update(existing.revoke(now, session.refreshTokenId));

    logger.info(
      { userId: user.id, rotatedTokenId: existing.id, newTokenId: session.refreshTokenId },
      'Refresh token rotated',
    );
    return session;
  }
}
