import jwt from 'jsonwebtoken';
import { type Clock, UnauthenticatedError } from '@leen-mart/domain-kit';
import { toUserId } from '../../domain/value-objects/user-id.value-object.js';
import type {
  AccessTokenClaims,
  AccessTokenService,
  SignedAccessToken,
} from '../../application/ports/access-token.port.js';
import { type RoleName } from '../../domain/value-objects/role.value-object.js';

export interface JsonWebTokenAccessTokenServiceConfig {
  readonly secret: string;
  readonly issuer: string;
  readonly ttlSeconds: number;
}

const ROLE_NAMES: readonly RoleName[] = ['CUSTOMER', 'VENDOR', 'ADMIN'];

const isRoleName = (value: unknown): value is RoleName =>
  typeof value === 'string' && (ROLE_NAMES as readonly string[]).includes(value);

/** JWT-backed access tokens (SDD 6.1), HS256 signed and issuer-scoped. */
export class JsonWebTokenAccessTokenService implements AccessTokenService {
  constructor(
    private readonly config: JsonWebTokenAccessTokenServiceConfig,
    private readonly clock: Clock,
  ) {}

  sign(claims: AccessTokenClaims): SignedAccessToken {
    const token = jwt.sign({ role: claims.role }, this.config.secret, {
      subject: claims.sub,
      issuer: this.config.issuer,
      expiresIn: this.config.ttlSeconds,
    });
    const expiresAt = new Date(this.clock.nowMs() + this.config.ttlSeconds * 1000);
    return { token, expiresAt };
  }

  verify(token: string): AccessTokenClaims {
    try {
      const payload = jwt.verify(token, this.config.secret, { issuer: this.config.issuer });
      if (
        typeof payload === 'string' ||
        typeof payload.sub !== 'string' ||
        !isRoleName(payload.role)
      ) {
        throw new TypeError('Malformed access token payload');
      }
      return { sub: toUserId(payload.sub), role: payload.role };
    } catch (cause) {
      throw new UnauthenticatedError('Invalid or expired access token.', {
        code: 'INVALID_ACCESS_TOKEN',
        cause,
      });
    }
  }
}
