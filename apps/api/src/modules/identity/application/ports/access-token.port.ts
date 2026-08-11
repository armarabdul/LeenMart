import type { UserId } from '../../domain/value-objects/user-id.value-object.js';
import type { SessionId } from '../../domain/value-objects/session-id.value-object.js';
import type { RoleName } from '../../domain/value-objects/role.value-object.js';

/**
 * What a caller supplies to mint a token. `jti` is deliberately absent: the
 * service generates it per token, so no call site can forget it or reuse one
 * (SDD 7.2 requires it to identify an individual token).
 */
export interface AccessTokenSubject {
  readonly sub: UserId;
  /** The persisted session this token belongs to — SDD 7.2's `sid`. */
  readonly sid: SessionId;
  readonly role: RoleName;
}

/**
 * What a verified token yields (SDD 7.2's claim set). `iss`, `aud`, `exp` and
 * `iat` are verified by the service rather than surfaced: a caller that has
 * been handed these claims already knows the token passed all four.
 */
export interface AccessTokenClaims {
  readonly sub: UserId;
  readonly sid: SessionId;
  readonly jti: string;
  readonly role: RoleName;
}

export interface SignedAccessToken {
  readonly token: string;
  readonly expiresAt: Date;
}

/**
 * JWT access tokens (SDD 6.1 / 7.2).
 *
 * `verify()` answers only "is this token itself well-formed, unexpired, and
 * meant for us?" — it deliberately says nothing about whether the session
 * behind it is still alive. That is `SessionDenylist`'s question, asked
 * separately by the authentication middleware, because a bearer token cannot
 * carry the answer: the session may have died after the token was signed.
 */
export interface AccessTokenService {
  sign(subject: AccessTokenSubject): SignedAccessToken;
  verify(token: string): AccessTokenClaims;
}
