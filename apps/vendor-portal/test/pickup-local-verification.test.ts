import { describe, expect, it } from 'vitest';
import { verifyPickupTokenLocally } from '@/features/vendor-order/pickup-local-verification';

/**
 * The same insecure dev Ed25519 keypair `env.ts` defaults
 * `VITE_PICKUP_TOKEN_PUBLIC_KEY` to (and that the backend's own `env.ts`
 * defaults `PICKUP_TOKEN_PRIVATE_KEY`/`PICKUP_TOKEN_PUBLIC_KEY` to) — reused
 * here so these tests sign tokens the module under test actually verifies
 * against, without mocking `env`.
 */
const DEV_PRIVATE_KEY_PEM =
  '-----BEGIN PRIVATE KEY-----\nMC4CAQAwBQYDK2VwBCIEIILsdERXf17y2+3M7qCTQfGKxvU2ma2mkiIgUC4avaKh\n-----END PRIVATE KEY-----\n';

const pemToDer = (pem: string): Uint8Array => {
  const base64 = pem.replace(/-----(BEGIN|END) [A-Z ]+-----/g, '').replace(/\s+/g, '');
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
};

const bytesToBase64Url = (bytes: ArrayBuffer): string => {
  const binary = String.fromCharCode(...new Uint8Array(bytes));
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

const importDevPrivateKey = (): Promise<CryptoKey> =>
  crypto.subtle.importKey('pkcs8', pemToDer(DEV_PRIVATE_KEY_PEM), { name: 'Ed25519' }, false, [
    'sign',
  ]);

interface SignOptions {
  readonly soid?: string;
  readonly aud?: string;
  readonly exp?: number;
  readonly alg?: string;
}

const signToken = async (options: SignOptions = {}): Promise<string> => {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const header = { alg: options.alg ?? 'EdDSA', typ: 'JWT' };
  const payload = {
    soid: options.soid ?? '01a01e00-0000-7000-8000-000000000001',
    nonce: 'a'.repeat(32),
    aud: options.aud ?? 'pickup',
    iat: nowSeconds,
    exp: options.exp ?? nowSeconds + 90,
  };
  const headerB64 = btoa(JSON.stringify(header))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  const payloadB64 = btoa(JSON.stringify(payload))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  const signingInput = `${headerB64}.${payloadB64}`;

  const privateKey = await importDevPrivateKey();
  const signature = await crypto.subtle.sign(
    { name: 'Ed25519' },
    privateKey,
    new TextEncoder().encode(signingInput),
  );

  return `${signingInput}.${bytesToBase64Url(signature)}`;
};

describe('verifyPickupTokenLocally (S4-QR-FALLBACK)', () => {
  it('accepts a validly signed, unexpired, correctly audienced token', async () => {
    const token = await signToken();

    await expect(verifyPickupTokenLocally(token)).resolves.toEqual({ valid: true });
  });

  it('rejects an expired token', async () => {
    const nowSeconds = Math.floor(Date.now() / 1000);
    const token = await signToken({ exp: nowSeconds - 60 });

    await expect(verifyPickupTokenLocally(token)).resolves.toEqual({ valid: false });
  });

  it('rejects a forged signature', async () => {
    const token = await signToken();
    const tampered = `${token.slice(0, -3)}${token.endsWith('AAA') ? 'BBB' : 'AAA'}`;

    await expect(verifyPickupTokenLocally(tampered)).resolves.toEqual({ valid: false });
  });

  it('rejects the wrong audience', async () => {
    const token = await signToken({ aud: 'not-pickup' });

    await expect(verifyPickupTokenLocally(token)).resolves.toEqual({ valid: false });
  });

  it('rejects an unsupported algorithm — never trusts an attacker-controlled header', async () => {
    const token = await signToken({ alg: 'none' });

    await expect(verifyPickupTokenLocally(token)).resolves.toEqual({ valid: false });
  });

  it('rejects a malformed token without throwing', async () => {
    await expect(verifyPickupTokenLocally('not-a-token')).resolves.toEqual({ valid: false });
  });

  it('rejects an empty string without throwing', async () => {
    await expect(verifyPickupTokenLocally('')).resolves.toEqual({ valid: false });
  });
});
