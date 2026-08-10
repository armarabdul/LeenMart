import type { UserId } from '../../domain/value-objects/user-id.value-object.js';
import type { RoleName } from '../../domain/value-objects/role.value-object.js';

/**
 * The authenticated caller, derived from a verified access token (SDD 7.4
 * step 1: "who is this?"). Deliberately carries only what the current token
 * actually contains — `sub` and `role` — not `sid`/`jti`/`vendorId`/
 * permissions/ownership data, since none of that exists in the token today
 * (see the JWT/SDD 7.2 discrepancy noted on `JsonWebTokenAccessTokenService`).
 *
 * Kept distinct from `AccessTokenClaims` rather than reused: this is the
 * HTTP/application-boundary shape callers read, decoupled from the token's
 * own field naming so the token's contents can evolve without forcing every
 * `Principal` consumer to change.
 */
export interface Principal {
  readonly userId: UserId;
  readonly role: RoleName;
}
