import type { UserId } from '../../domain/value-objects/user-id.value-object.js';
import type { SessionId } from '../../domain/value-objects/session-id.value-object.js';
import type { RoleName } from '../../domain/value-objects/role.value-object.js';

/**
 * The authenticated caller, derived from a verified access token (SDD 7.4
 * step 1: "who is this?").
 *
 * Carries `sessionId` as well as the subject and role: with SDD 7.2's `sid`
 * now in the token, "which session is this request on?" is answerable, and it
 * is what makes per-session actions (ending *this* session, listing devices)
 * expressible without a second lookup. `jti` is deliberately not carried —
 * revocation is session-scoped, so no consumer needs the individual token's
 * id, and putting it on the request object would invite it into a log line.
 *
 * Kept distinct from `AccessTokenClaims` rather than reused: this is the
 * HTTP/application-boundary shape callers read, decoupled from the token's
 * own field naming so the token's contents can evolve without forcing every
 * `Principal` consumer to change.
 */
export interface Principal {
  readonly userId: UserId;
  readonly sessionId: SessionId;
  readonly role: RoleName;
}
