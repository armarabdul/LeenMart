import jwt from 'jsonwebtoken';
import { type Clock, type IdGenerator, UnauthenticatedError } from '@leen-mart/domain-kit';
import { toUserId } from '../../domain/value-objects/user-id.value-object.js';
import { toSessionId } from '../../domain/value-objects/session-id.value-object.js';
import type {
  AccessTokenClaims,
  AccessTokenService,
  AccessTokenSubject,
  SignedAccessToken,
} from '../../application/ports/access-token.port.js';
import { type RoleName } from '../../domain/value-objects/role.value-object.js';

export interface JsonWebTokenAccessTokenServiceConfig {
  readonly secret: string;
  readonly issuer: string;
  /** SDD 7.2's `aud`. Verified on every token, so one service's tokens are not accepted by another. */
  readonly audience: string;
  readonly ttlSeconds: number;
}

const ROLE_NAMES: readonly RoleName[] = [
  'CUSTOMER',
  'VENDOR_OWNER',
  'VENDOR_MANAGER',
  'VENDOR_STAFF',
  'SUPER_ADMIN',
  'CATALOGUE_MODERATOR',
  'FINANCE_ADMIN',
  'RISK_ANALYST',
  'SUPPORT_AGENT',
];

const isRoleName = (value: unknown): value is RoleName =>
  typeof value === 'string' && (ROLE_NAMES as readonly string[]).includes(value);

/**
 * JWT-backed access tokens (SDD 6.1 / 7.2), issuer- and audience-scoped.
 *
 * Carries SDD 7.2's full claim set: `sub`, `sid`, `role`, `jti`, `exp`, `iat`,
 * `aud`, `iss`. `vendorId` is the one listed claim deliberately absent — it is
 * optional in the SDD and no endpoint reads it yet, so emitting it would put a
 * value in a signed credential that nothing validates.
 *
 * Still **HS256**, not SDD 7.2's EdDSA/Ed25519. That migration also requires
 * key storage, a `kid`-keyed JWKS and a quarterly rotation window, none of
 * which this chunk establishes — recorded here as an open discrepancy rather
 * than half-done.
 */
export class JsonWebTokenAccessTokenService implements AccessTokenService {
  constructor(
    private readonly config: JsonWebTokenAccessTokenServiceConfig,
    private readonly clock: Clock,
    /** Mints `jti`. Injected rather than called inline so tokens stay deterministic under a fake generator in tests. */
    private readonly idGenerator: IdGenerator,
  ) {}

  sign(subject: AccessTokenSubject): SignedAccessToken {
    // `jti` is generated here, not accepted from the caller: uniqueness per
    // issued token (SDD 7.2) is then a property of this service rather than a
    // convention every call site has to remember.
    const token = jwt.sign({ role: subject.role, sid: subject.sid }, this.config.secret, {
      subject: subject.sub,
      issuer: this.config.issuer,
      audience: this.config.audience,
      jwtid: this.idGenerator.generate(),
      expiresIn: this.config.ttlSeconds,
    });
    const expiresAt = new Date(this.clock.nowMs() + this.config.ttlSeconds * 1000);
    return { token, expiresAt };
  }

  verify(token: string): AccessTokenClaims {
    try {
      const payload = jwt.verify(token, this.config.secret, {
        issuer: this.config.issuer,
        audience: this.config.audience,
      });
      if (
        typeof payload === 'string' ||
        typeof payload.sub !== 'string' ||
        typeof payload.sid !== 'string' ||
        typeof payload.jti !== 'string' ||
        !isRoleName(payload.role)
      ) {
        throw new TypeError('Malformed access token payload');
      }
      return {
        sub: toUserId(payload.sub),
        sid: toSessionId(payload.sid),
        jti: payload.jti,
        role: payload.role,
      };
    } catch (cause) {
      // Every failure — bad signature, wrong issuer, wrong audience, expired,
      // malformed claims — collapses to one error, so a caller cannot learn
      // *why* their token was refused (SEC-15). `cause` is retained for logs,
      // which never include the token itself.
      throw new UnauthenticatedError('Invalid or expired access token.', {
        code: 'INVALID_ACCESS_TOKEN',
        cause,
      });
    }
  }
}
