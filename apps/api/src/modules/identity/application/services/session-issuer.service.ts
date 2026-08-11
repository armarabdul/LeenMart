import type { Clock, IdGenerator } from '@leen-mart/domain-kit';
import { RefreshToken } from '../../domain/entities/refresh-token.entity.js';
import type { User } from '../../domain/entities/user.entity.js';
import { toSessionId, type SessionId } from '../../domain/value-objects/session-id.value-object.js';
import type { AccessTokenService } from '../ports/access-token.port.js';
import type { RefreshTokenHasher } from '../ports/refresh-token-hasher.port.js';
import type { RefreshTokenRepository } from '../ports/refresh-token-repository.port.js';

export interface AuthSession {
  readonly user: User;
  readonly accessToken: string;
  readonly accessTokenExpiresAt: Date;
  readonly refreshToken: string;
  readonly refreshTokenExpiresAt: Date;
  /** Internal id of the persisted refresh token, used to link rotation. Not exposed on the wire. */
  readonly refreshTokenId: SessionId;
  /** The rotation lineage this session belongs to (SDD 7.2). Internal, never on the wire. */
  readonly refreshTokenFamilyId: SessionId;
}

export interface SessionIssuerDeps {
  readonly accessTokenService: AccessTokenService;
  readonly refreshTokenHasher: RefreshTokenHasher;
  readonly refreshTokenRepository: RefreshTokenRepository;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
  readonly refreshTtlDays: number;
  /** SDD 7.5's admin-console idle timeout, applied instead of `refreshTtlDays` to admin sessions. */
  readonly adminIdleTimeoutMinutes: number;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const MS_PER_MINUTE = 60 * 1000;

/**
 * Issues a matched access + refresh token pair and persists the refresh
 * token's hash (SDD 6.1). Shared by register, login and refresh (rotation) so
 * the pairing logic exists in exactly one place.
 */
export class SessionIssuer {
  constructor(private readonly deps: SessionIssuerDeps) {}

  /**
   * How long the issued refresh token stays valid.
   *
   * SDD 7.5 gives the admin console a **30-minute idle timeout**, against
   * SDD 7.2's 30-day sliding window for everyone else. The distinction is
   * decided here rather than at each call site because every path that mints
   * an admin session — login step two, enrollment confirmation, and every
   * later rotation — goes through this method, and a rule applied in only
   * some of them would leave the longest-lived admin session unbounded.
   *
   * "Idle" falls out of SDD 7.2 making refresh tokens sliding: a rotation
   * issues a fresh window, so an admin who keeps working never lapses, while
   * one who stops for the timeout must re-authenticate with password and
   * TOTP. That is what keeps the highest-privilege session in the system
   * (SEC-08: approvals, suspensions, fund holds, refunds) from outliving the
   * person at the keyboard.
   */
  private refreshWindowMs(user: User): number {
    const { refreshTtlDays, adminIdleTimeoutMinutes } = this.deps;
    return user.role.isAdmin()
      ? adminIdleTimeoutMinutes * MS_PER_MINUTE
      : refreshTtlDays * MS_PER_DAY;
  }

  /**
   * @param familyId The rotation lineage to continue (SDD 7.2). Only the
   * refresh path passes it; every other caller is a fresh login and roots its
   * own family, which is what keeps one device's compromise from reaching
   * another device's session.
   */
  async issueFor(user: User, familyId?: SessionId): Promise<AuthSession> {
    const { accessTokenService, refreshTokenHasher, refreshTokenRepository, idGenerator, clock } =
      this.deps;

    const now = clock.now();
    const accessToken = accessTokenService.sign({ sub: user.id, role: user.role.name });

    const rawRefreshToken = refreshTokenHasher.generate();
    const refreshTokenExpiresAt = new Date(now.getTime() + this.refreshWindowMs(user));
    const refreshTokenEntity = RefreshToken.issue({
      id: toSessionId(idGenerator.generate()),
      userId: user.id,
      tokenHash: refreshTokenHasher.hash(rawRefreshToken),
      expiresAt: refreshTokenExpiresAt,
      now,
      ...(familyId === undefined ? {} : { familyId }),
    });
    await refreshTokenRepository.create(refreshTokenEntity);

    return {
      user,
      accessToken: accessToken.token,
      accessTokenExpiresAt: accessToken.expiresAt,
      refreshToken: rawRefreshToken,
      refreshTokenExpiresAt,
      refreshTokenId: refreshTokenEntity.id,
      refreshTokenFamilyId: refreshTokenEntity.familyId,
    };
  }
}
