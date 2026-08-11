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
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Issues a matched access + refresh token pair and persists the refresh
 * token's hash (SDD 6.1). Shared by register, login and refresh (rotation) so
 * the pairing logic exists in exactly one place.
 */
export class SessionIssuer {
  constructor(private readonly deps: SessionIssuerDeps) {}

  /**
   * @param familyId The rotation lineage to continue (SDD 7.2). Only the
   * refresh path passes it; every other caller is a fresh login and roots its
   * own family, which is what keeps one device's compromise from reaching
   * another device's session.
   */
  async issueFor(user: User, familyId?: SessionId): Promise<AuthSession> {
    const {
      accessTokenService,
      refreshTokenHasher,
      refreshTokenRepository,
      idGenerator,
      clock,
      refreshTtlDays,
    } = this.deps;

    const now = clock.now();
    const accessToken = accessTokenService.sign({ sub: user.id, role: user.role.name });

    const rawRefreshToken = refreshTokenHasher.generate();
    const refreshTokenExpiresAt = new Date(now.getTime() + refreshTtlDays * MS_PER_DAY);
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
