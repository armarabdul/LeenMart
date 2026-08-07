import type { Uuid } from '@leen-mart/domain-kit';
import type { RoleName } from '../../domain/entities/role.entity.js';

export interface AccessTokenClaims {
  readonly sub: Uuid;
  readonly role: RoleName;
}

export interface SignedAccessToken {
  readonly token: string;
  readonly expiresAt: Date;
}

/**
 * JWT access tokens (SDD 6.1).
 *
 * `verify` is not called anywhere in this module today — none of
 * register/login/refresh/logout need to authenticate a caller. It is
 * published so a future module can build a request-auth guard against it
 * without reaching into this module's infrastructure (SDD 5.1).
 */
export interface AccessTokenService {
  sign(claims: AccessTokenClaims): SignedAccessToken;
  verify(token: string): AccessTokenClaims;
}
