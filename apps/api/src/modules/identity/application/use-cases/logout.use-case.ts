import type { Clock, Logger } from '@leen-mart/domain-kit';
import type { RefreshTokenHasher } from '../ports/refresh-token-hasher.port.js';
import type { RefreshTokenRepository } from '../ports/refresh-token-repository.port.js';
import type { SessionDenylist } from '../ports/session-denylist.port.js';

export interface LogoutInput {
  readonly refreshToken: string;
}

export interface LogoutDeps {
  readonly refreshTokenRepository: RefreshTokenRepository;
  readonly refreshTokenHasher: RefreshTokenHasher;
  readonly sessionDenylist: SessionDenylist;
  /** The access-token TTL, which bounds how long the denylist entry must live (SDD 7.2). */
  readonly accessTokenTtlSeconds: number;
  readonly clock: Clock;
  readonly logger: Logger;
}

/**
 * Revokes a session. Idempotent by design: an unknown or already-revoked
 * token still completes successfully, so this endpoint can never be used to
 * probe whether a given token is currently valid.
 *
 * Revoking the refresh row is only half of logging out. The access token
 * already in the client's hands stays signature-valid until it expires, so
 * until SDD 7.2's denylist is also written, "log out" left the caller able to
 * keep reaching every authenticated endpoint for the rest of the access
 * token's life. Both writes happen here, together.
 */
export class LogoutUseCase {
  constructor(private readonly deps: LogoutDeps) {}

  async execute(input: LogoutInput): Promise<void> {
    const {
      refreshTokenRepository,
      refreshTokenHasher,
      sessionDenylist,
      accessTokenTtlSeconds,
      clock,
      logger,
    } = this.deps;

    const tokenHash = refreshTokenHasher.hash(input.refreshToken);
    const existing = await refreshTokenRepository.findByTokenHash(tokenHash);

    if (!existing || existing.isRevoked()) {
      return;
    }

    await refreshTokenRepository.update(existing.revoke(clock.now()));
    await sessionDenylist.deny(existing.id, accessTokenTtlSeconds);

    // The session id is safe to log — it is an opaque identifier, not a
    // credential. The refresh token and the access token never are.
    logger.info({ sessionId: existing.id }, 'Session revoked (logout)');
  }
}
