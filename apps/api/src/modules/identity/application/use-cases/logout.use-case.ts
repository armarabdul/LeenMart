import { toUuid, type Clock, type Logger } from '@leen-mart/domain-kit';
import type { AuditWriter } from '../../../audit/index.js';
import { IDENTITY_AUDIT_ACTIONS, IDENTITY_AUDIT_ENTITY_TYPES } from '../../domain/audit-actions.js';
import type { RefreshTokenHasher } from '../ports/refresh-token-hasher.port.js';
import type { RefreshTokenRepository } from '../ports/refresh-token-repository.port.js';
import type { SessionDenylist } from '../ports/session-denylist.port.js';
import type { UserRepository } from '../ports/user-repository.port.js';

export interface LogoutInput {
  readonly refreshToken: string;
}

export interface LogoutDeps {
  readonly userRepository: UserRepository;
  readonly refreshTokenRepository: RefreshTokenRepository;
  readonly refreshTokenHasher: RefreshTokenHasher;
  readonly sessionDenylist: SessionDenylist;
  readonly auditWriter: AuditWriter;
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
 *
 * An administrator's logout is additionally written to the audit log (SDD
 * 18.4). The account is loaded to answer one question this use case could not
 * previously ask: **whose** session this is. `/logout` is a single endpoint
 * shared by customers and administrators and carries only an opaque refresh
 * token, so without the account there is no role — and SDD 18.4 requires
 * `actorRole` on every entry. Customers are unaffected: the load happens for
 * everyone, the audit write does not.
 */
export class LogoutUseCase {
  constructor(private readonly deps: LogoutDeps) {}

  async execute(input: LogoutInput): Promise<void> {
    const {
      userRepository,
      refreshTokenRepository,
      refreshTokenHasher,
      sessionDenylist,
      auditWriter,
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

    // After the revocation, not before: the security-positive act is ending
    // the session, and it must not be held up by the record of it. If the
    // audit write then fails the caller sees an error, but they are genuinely
    // logged out — the safe direction to fail in.
    const user = await userRepository.findById(existing.userId);
    if (user?.role.isAdmin() === true) {
      await auditWriter.record({
        actorId: user.id,
        actorRole: user.role.name,
        action: IDENTITY_AUDIT_ACTIONS.ADMIN_LOGOUT,
        entityType: IDENTITY_AUDIT_ENTITY_TYPES.USER,
        entityId: toUuid(user.id),
      });
    }

    // The session id is safe to log — it is an opaque identifier, not a
    // credential. The refresh token and the access token never are.
    logger.info({ sessionId: existing.id }, 'Session revoked (logout)');
  }
}
