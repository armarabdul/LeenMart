import type { Logger } from '@leen-mart/domain-kit';
import type {
  SessionDenylist,
  SessionId,
  SessionRepository,
  UserId,
} from '../../../modules/identity/index.js';

export interface RevokeEverySessionDeps {
  readonly sessionRepository: SessionRepository;
  readonly sessionDenylist: SessionDenylist;
  /** The access-token lifetime, which is how long a denylist entry must live (SDD 7.2). */
  readonly accessTokenTtlSeconds: number;
  readonly logger: Logger;
}

/**
 * Kills every session a user holds and denies each one's access token.
 *
 * Extracted from `RegisterVendorUseCase` (S3-2), which needed this once, for
 * vendor promotion; vendor suspension (L.4) is the second concrete caller —
 * exactly the threshold this codebase's own philosophy extracts at, no
 * earlier. Behaviour is unchanged from the original: reuses SDD 7.2's
 * existing two-step revocation exactly as `RefreshSessionUseCase` does —
 * revoking the refresh rows bounds future rotations, and denying each `sid`
 * is what stops the access tokens already in flight. Denies *all* session
 * ids, not just the ones this call killed — a session revoked minutes ago
 * can still hold a signature-valid token carrying the pre-revocation state,
 * which is precisely the credential that must stop working.
 *
 * Deliberately not run inside the caller's own database transaction: neither
 * `SessionRepository` nor `SessionDenylist` participate in a shared
 * `TransactionScope` (the denylist is Redis, not Postgres, and has no
 * transactional relationship to either store), and `RegisterVendorUseCase`'s
 * own reasoning for calling this after its transaction commits — "if it
 * failed inside, it would roll back a write that was legitimately made, and
 * if the process died between the two the worst case is a stale credential
 * that expires on its own within the access-token lifetime" — applies
 * identically to every caller, not just that one.
 */
export const revokeEverySession = async (
  deps: RevokeEverySessionDeps,
  userId: UserId,
  now: Date,
): Promise<void> => {
  const { sessionRepository, sessionDenylist, accessTokenTtlSeconds, logger } = deps;

  const revoked = await sessionRepository.revokeAllForUser(userId, now);
  const allSessionIds = await sessionRepository.findSessionIdsByUserId(userId);
  await Promise.all(
    allSessionIds.map((sessionId: SessionId) =>
      sessionDenylist.deny(sessionId, accessTokenTtlSeconds),
    ),
  );

  logger.info(
    { userId, revokedCount: revoked.length, deniedCount: allSessionIds.length },
    'Revoked every session for the account (SDD 7.2)',
  );
};
