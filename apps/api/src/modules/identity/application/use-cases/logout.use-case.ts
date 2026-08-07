import type { Clock, Logger } from '@leen-mart/domain-kit';
import type { RefreshTokenHasher } from '../ports/refresh-token-hasher.port.js';
import type { RefreshTokenRepository } from '../ports/refresh-token-repository.port.js';

export interface LogoutInput {
  readonly refreshToken: string;
}

export interface LogoutDeps {
  readonly refreshTokenRepository: RefreshTokenRepository;
  readonly refreshTokenHasher: RefreshTokenHasher;
  readonly clock: Clock;
  readonly logger: Logger;
}

/**
 * Revokes a refresh token. Idempotent by design: an unknown or already-
 * revoked token still completes successfully, so this endpoint can never be
 * used to probe whether a given token is currently valid.
 */
export class LogoutUseCase {
  constructor(private readonly deps: LogoutDeps) {}

  async execute(input: LogoutInput): Promise<void> {
    const { refreshTokenRepository, refreshTokenHasher, clock, logger } = this.deps;

    const tokenHash = refreshTokenHasher.hash(input.refreshToken);
    const existing = await refreshTokenRepository.findByTokenHash(tokenHash);

    if (!existing || existing.isRevoked()) {
      return;
    }

    await refreshTokenRepository.update(existing.revoke(clock.now()));
    logger.info({ tokenId: existing.id }, 'Refresh token revoked (logout)');
  }
}
