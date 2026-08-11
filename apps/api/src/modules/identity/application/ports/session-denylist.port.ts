import type { SessionId } from '../../domain/value-objects/session-id.value-object.js';

/**
 * SDD 7.2's revocation backstop.
 *
 * A revoked session's *refresh* token dies in the database, but the access
 * token it already minted is a bearer credential no server-side row can
 * retract — it stays signature-valid until `exp`. SDD 7.2 closes that window
 * with a Redis denylist consulted on every authenticated request, capping
 * exposure at the access-token lifetime ("max 10 minutes of exposure").
 *
 * **Keyed by `sid`, not `jti`.** SDD 7.2's prose says "adds the live `jti`s
 * to a Redis denylist", but a revoker holds the *session*, not the set of
 * tokens minted from it — honouring that literally would mean recording every
 * issued `jti` against its session purely so it could be enumerated later.
 * Denying the `sid` reaches every token that session ever minted, present and
 * past, with one key and no bookkeeping, and delivers the identical
 * guarantee. `jti` is still carried in the token per SDD 7.2's claim table and
 * remains available if per-token denial is ever needed.
 *
 * Redis is the right store precisely because entries are short-lived and
 * reconstructible: the database remains the source of truth for revocation
 * (SDD 22.2 treats Redis as disposable). A lost Redis restores to "access
 * tokens live out their ≤10 minutes", which is the pre-existing bound, not a
 * new failure mode.
 */
export interface SessionDenylist {
  /**
   * Denies every access token bearing this `sid`.
   *
   * @param ttlSeconds How long the entry lives. Callers pass the access-token
   * TTL: a token still in flight was issued at most that long ago, so this is
   * simultaneously the tightest bound that covers every live token and the
   * loosest one SDD 7.2 permits. Keeping the entry longer would pin dead
   * sessions in memory for no security gain, since the tokens themselves have
   * expired by then.
   */
  deny(sessionId: SessionId, ttlSeconds: number): Promise<void>;

  isDenied(sessionId: SessionId): Promise<boolean>;
}
