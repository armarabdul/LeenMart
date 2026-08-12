import type { SessionId } from '../value-objects/session-id.value-object.js';
import type { UserId } from '../value-objects/user-id.value-object.js';
import type { Session } from '../entities/session.entity.js';

/** Uses `string` for the hash lookup, matching `Session.tokenHash` — never look up a session by anything but its hash. */
export interface SessionRepository {
  create(session: Session): Promise<void>;
  update(session: Session): Promise<void>;
  findByTokenHash(tokenHash: string): Promise<Session | null>;

  /**
   * Revokes every still-live session in one rotation lineage and returns the
   * ids of the sessions it killed (SDD 7.2: on reuse detection "the entire
   * session family is revoked").
   *
   * One indexed lookup-and-`UPDATE` rather than walking `replacedByTokenId`
   * link by link. A 30-day sliding family refreshed on a 15-minute access
   * token can run to thousands of links, and this path is reached only by
   * *presenting a stolen token* — so a per-request walk would hand an
   * attacker a way to force thousands of queries at will. The family id makes
   * the blast radius one round trip regardless of chain length.
   *
   * Returns ids rather than a count because killing the refresh rows is only
   * half of revocation: each dead session's *access* token stays
   * signature-valid until it expires, and denying it needs that session's id
   * (SDD 7.2's denylist). The count callers used to log is `.length`.
   *
   * Already-revoked rows are left alone, so the result is the set of sessions
   * this call actually killed — the real blast radius, not a restatement of
   * the family's size, and empty on a replay of the same stolen token.
   */
  revokeFamily(familyId: SessionId, now: Date): Promise<readonly SessionId[]>;

  /**
   * Every session id in one rotation lineage, **including already-revoked
   * ones**, for SDD 7.2's "the entire session family is revoked".
   *
   * Distinct from `revokeFamily`'s return value, which is only what that call
   * killed. On reuse detection the two differ in exactly the way that
   * matters: the token being replayed was rotated away, so it is *already*
   * revoked and `revokeFamily` will not report it — yet its access token may
   * still be seconds from minted and is precisely the credential a thief
   * holding that refresh token is likely to hold too. Denying only the live
   * sessions would leave the replayed session, and any earlier rotation,
   * authenticating for the rest of the access-token lifetime.
   *
   * Read-only, so it carries no `now`. Bounded by the family, which is one
   * indexed lookup regardless of chain length.
   */
  findFamilySessionIds(familyId: SessionId): Promise<readonly SessionId[]>;

  /**
   * Revokes every still-live session belonging to one user, across *all*
   * rotation lineages, and returns the ids it killed.
   *
   * The family-scoped pair above is not enough for this: a family is one login
   * and its rotations, and a user who signed in on a laptop and a phone holds
   * two of them. A change to what the account *is* — its role — has to reach
   * every one, not just the lineage that happened to make the request.
   *
   * Mirrors `revokeFamily` exactly: already-revoked rows are left alone, so
   * the result is the real blast radius, and the ids are returned because
   * killing refresh rows is only half of revocation (SDD 7.2).
   */
  revokeAllForUser(userId: UserId, now: Date): Promise<readonly SessionId[]>;

  /**
   * Every session id belonging to one user, **including already-revoked
   * ones** — the user-scoped counterpart of `findFamilySessionIds`, and for
   * the same reason: a session revoked minutes ago may still have a
   * signature-valid access token carrying the old role, and that token is
   * exactly what must stop working.
   */
  findSessionIdsByUserId(userId: UserId): Promise<readonly SessionId[]>;
}
