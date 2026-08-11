import type { SessionId } from '../value-objects/session-id.value-object.js';
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
}
