import {
  createPrivateKey,
  createPublicKey,
  randomBytes,
  sign as cryptoSign,
  verify as cryptoVerify,
  type KeyObject,
} from 'node:crypto';
import type { Clock } from '@leen-mart/domain-kit';
import { PickupTokenInvalidError } from '../../domain/errors/order-errors.js';
import { toSubOrderId } from '../../domain/value-objects/sub-order-id.value-object.js';
import type {
  PickupTokenPayload,
  PickupTokenSigner,
  SignedPickupToken,
} from '../../application/ports/pickup-token-signer.port.js';

export interface Ed25519PickupTokenSignerConfig {
  readonly privateKeyPem: string;
  readonly publicKeyPem: string;
  readonly ttlSeconds: number;
}

/** SDD 13.1's `aud: "pickup"` — the same purpose `JWT_AUDIENCE` serves for access tokens: one credential cannot be replayed as another. */
const AUDIENCE = 'pickup';

const HEADER_B64 = Buffer.from(JSON.stringify({ alg: 'EdDSA', typ: 'JWT' })).toString('base64url');

interface PickupTokenClaims {
  readonly soid: string;
  readonly nonce: string;
  readonly aud: typeof AUDIENCE;
  readonly iat: number;
  readonly exp: number;
}

const isPickupTokenClaims = (value: unknown): value is PickupTokenClaims =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as Record<string, unknown>).soid === 'string' &&
  typeof (value as Record<string, unknown>).nonce === 'string' &&
  (value as Record<string, unknown>).aud === AUDIENCE &&
  typeof (value as Record<string, unknown>).exp === 'number';

/**
 * Ed25519-signed pickup credentials (S4-QR, SDD §13.1), built directly on
 * Node's own `crypto` module — deliberately **not** the `jsonwebtoken`
 * package `AccessTokenService` uses. The dependency actually installed in
 * this repository (`jsonwebtoken@9.0.2` with `jws@3.2.3`) does not recognise
 * `'EdDSA'` at runtime despite being new enough on paper — verified directly
 * (`jwt.sign(..., { algorithm: 'EdDSA' })` throws `"algorithm" must be a
 * valid string enum value`) before writing this class. Upgrading that chain
 * would be a version bump touching the identity module's own, already-
 * working `JsonWebTokenAccessTokenService` and its test suite for a
 * capability only this one signer needs — the smaller, safer change is a
 * ~40-line hand-rolled compact JWS, using exactly the primitives Node ships
 * (`crypto.sign(null, data, key)`/`crypto.verify(null, data, key, sig)`,
 * which is the standard, correct call shape for Ed25519 — the algorithm
 * itself does the hashing, so no digest name is passed).
 *
 * The result is still a standard three-part compact JWS
 * (`base64url(header).base64url(payload).base64url(signature)`), decodable
 * by any conformant JWT library — this is a different *implementation* of
 * the same wire format, not a different format.
 *
 * Signs with the private key, verifies with the public key — a real
 * asymmetric split. `verify` never distinguishes *why* a token was refused
 * (SEC-15, mirroring `AccessTokenService.verify()`'s own doc comment).
 */
export class Ed25519PickupTokenSigner implements PickupTokenSigner {
  private readonly privateKey: KeyObject;
  private readonly publicKey: KeyObject;

  constructor(
    private readonly config: Ed25519PickupTokenSignerConfig,
    private readonly clock: Clock,
  ) {
    this.privateKey = createPrivateKey(config.privateKeyPem);
    this.publicKey = createPublicKey(config.publicKeyPem);
  }

  sign(subOrderId: string): SignedPickupToken {
    const nonce = randomBytes(16).toString('hex');
    const nowSeconds = Math.floor(this.clock.nowMs() / 1000);
    const claims: PickupTokenClaims = {
      soid: subOrderId,
      nonce,
      aud: AUDIENCE,
      iat: nowSeconds,
      exp: nowSeconds + this.config.ttlSeconds,
    };
    const payloadB64 = Buffer.from(JSON.stringify(claims)).toString('base64url');
    const signingInput = `${HEADER_B64}.${payloadB64}`;
    const signature = cryptoSign(null, Buffer.from(signingInput), this.privateKey).toString(
      'base64url',
    );
    const token = `${signingInput}.${signature}`;

    return {
      token,
      nonce,
      issuedAt: new Date(this.clock.nowMs()),
      expiresAt: new Date(claims.exp * 1000),
    };
  }

  verify(token: string): PickupTokenPayload {
    try {
      const parts = token.split('.');
      if (parts.length !== 3) {
        throw new TypeError('Malformed pickup token');
      }
      const [headerB64, payloadB64, signatureB64] = parts as [string, string, string];

      const header = JSON.parse(Buffer.from(headerB64, 'base64url').toString('utf8')) as unknown;
      if (
        typeof header !== 'object' ||
        header === null ||
        (header as Record<string, unknown>).alg !== 'EdDSA'
      ) {
        // Pinned exactly like `JsonWebTokenAccessTokenService.ALGORITHM`
        // (OWASP A02): the header's own claimed algorithm is
        // attacker-controlled input and is never trusted on its own — this
        // check refuses anything but the one algorithm this class signs
        // with, closing the same "alg: none" / algorithm-confusion class of
        // attack that comment documents.
        throw new TypeError('Unsupported pickup token algorithm');
      }

      const signingInput = `${headerB64}.${payloadB64}`;
      const signatureValid = cryptoVerify(
        null,
        Buffer.from(signingInput),
        this.publicKey,
        Buffer.from(signatureB64, 'base64url'),
      );
      if (!signatureValid) {
        throw new TypeError('Invalid pickup token signature');
      }

      const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8')) as unknown;
      if (!isPickupTokenClaims(payload)) {
        throw new TypeError('Malformed pickup token payload');
      }
      const nowSeconds = Math.floor(this.clock.nowMs() / 1000);
      if (payload.exp <= nowSeconds) {
        throw new TypeError('Expired pickup token');
      }

      return { subOrderId: toSubOrderId(payload.soid), nonce: payload.nonce };
    } catch (cause) {
      // Every failure — bad signature, wrong audience, expired, malformed,
      // wrong algorithm — collapses to one error (SEC-15).
      throw new PickupTokenInvalidError({ cause });
    }
  }
}
