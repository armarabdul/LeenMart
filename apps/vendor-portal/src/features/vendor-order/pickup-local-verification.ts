import { env } from '@/shared/config/env';

/**
 * Offline/local pickup-token verification (S4-QR-FALLBACK). Mirrors
 * `Ed25519PickupTokenSigner.verify()`'s own checks — algorithm pinning,
 * signature, audience, expiry — using the browser's native `crypto.subtle`
 * instead of Node's `crypto` module, so a scanned QR can be checked without
 * a network round-trip while offline.
 *
 * This is deliberately **preliminary only**: a positive result here is never
 * treated as a completed pickup. The server's own atomic `redeemIfIssued`
 * compare-and-set (`RedeemPickupTokenUseCase`) remains the sole
 * authoritative redemption path — this module only decides whether a token
 * is worth queuing for that server call at all.
 */

const AUDIENCE = 'pickup';

export interface LocalVerificationResult {
  readonly valid: boolean;
}

const base64UrlToBytes = (value: string): Uint8Array => {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
};

const pemToSpkiBytes = (pem: string): Uint8Array =>
  base64UrlToBytes(
    pem
      .replace('-----BEGIN PUBLIC KEY-----', '')
      .replace('-----END PUBLIC KEY-----', '')
      .replace(/\s+/g, '')
      // The PEM body is standard base64 (with `+`/`/`), not base64url — but
      // `base64UrlToBytes`'s substitutions are no-ops on an input that
      // already contains neither `-` nor `_`, so reusing it here avoids a
      // second, near-identical decoder.
      .replace(/-/g, '+')
      .replace(/_/g, '/'),
  );

let cachedKey: Promise<CryptoKey> | null = null;

const importPublicKey = (): Promise<CryptoKey> => {
  // A `Uint8Array` view, not `.buffer` — both are valid `BufferSource`, but
  // the view form is what every other call in this module already passes
  // (`base64UrlToBytes`'s own return type), so this stays consistent rather
  // than being the one call that unwraps to a bare `ArrayBuffer`.
  cachedKey ??= crypto.subtle.importKey(
    'spki',
    pemToSpkiBytes(env.pickupTokenPublicKey),
    { name: 'Ed25519' },
    false,
    ['verify'],
  );
  return cachedKey;
};

interface PickupTokenClaims {
  readonly soid: string;
  readonly aud: string;
  readonly exp: number;
}

const isPickupTokenClaims = (value: unknown): value is PickupTokenClaims =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as Record<string, unknown>).soid === 'string' &&
  typeof (value as Record<string, unknown>).aud === 'string' &&
  typeof (value as Record<string, unknown>).exp === 'number';

/**
 * Verifies a scanned pickup token's signature, algorithm, audience and
 * expiry entirely client-side. Never throws — any malformed input, a
 * `crypto.subtle` failure, or a genuinely invalid token all resolve to
 * `{ valid: false }`, matching the server's own uniform-failure discipline
 * (SEC-15): this module isn't the place to explain *why* a token failed
 * either.
 */
export const verifyPickupTokenLocally = async (token: string): Promise<LocalVerificationResult> => {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) {
      return { valid: false };
    }
    const [headerB64, payloadB64, signatureB64] = parts as [string, string, string];

    const header = JSON.parse(new TextDecoder().decode(base64UrlToBytes(headerB64))) as unknown;
    if (
      typeof header !== 'object' ||
      header === null ||
      (header as Record<string, unknown>).alg !== 'EdDSA'
    ) {
      return { valid: false };
    }

    const publicKey = await importPublicKey();
    const signingInput = new TextEncoder().encode(`${headerB64}.${payloadB64}`);
    const signatureValid = await crypto.subtle.verify(
      { name: 'Ed25519' },
      publicKey,
      base64UrlToBytes(signatureB64),
      signingInput,
    );
    if (!signatureValid) {
      return { valid: false };
    }

    const payload = JSON.parse(new TextDecoder().decode(base64UrlToBytes(payloadB64))) as unknown;
    if (!isPickupTokenClaims(payload)) {
      return { valid: false };
    }
    if (payload.aud !== AUDIENCE) {
      return { valid: false };
    }
    if (payload.exp <= Math.floor(Date.now() / 1000)) {
      return { valid: false };
    }

    return { valid: true };
  } catch {
    return { valid: false };
  }
};
