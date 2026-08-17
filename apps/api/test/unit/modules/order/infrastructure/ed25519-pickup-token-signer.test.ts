import { generateKeyPairSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { FixedClock } from '@leen-mart/domain-kit';
import { PickupTokenInvalidError } from '../../../../../src/modules/order/domain/errors/order-errors.js';
import { toSubOrderId } from '../../../../../src/modules/order/domain/value-objects/sub-order-id.value-object.js';
import { Ed25519PickupTokenSigner } from '../../../../../src/modules/order/infrastructure/crypto/ed25519-pickup-token-signer.js';

const { privateKey: privateKeyPem, publicKey: publicKeyPem } = generateKeyPairSync('ed25519', {
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});

const { publicKey: otherPublicKeyPem } = generateKeyPairSync('ed25519', {
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});

const subOrderId = toSubOrderId('00000000-0000-7000-8000-000000000d01');
const NOW = new Date('2026-01-01T00:00:00.000Z');
const TTL_SECONDS = 90;

const buildSigner = (clock: FixedClock, publicKey = publicKeyPem): Ed25519PickupTokenSigner =>
  new Ed25519PickupTokenSigner(
    { privateKeyPem, publicKeyPem: publicKey, ttlSeconds: TTL_SECONDS },
    clock,
  );

describe('Ed25519PickupTokenSigner', () => {
  it('signs a token that verifies back to the same sub-order', () => {
    const signer = buildSigner(new FixedClock(NOW));

    const signed = signer.sign(subOrderId);
    const payload = signer.verify(signed.token);

    expect(payload.subOrderId).toBe(subOrderId);
  });

  it('round-trips the nonce unchanged, so a caller can detect a rotated-out token', () => {
    const signer = buildSigner(new FixedClock(NOW));

    const signed = signer.sign(subOrderId);
    const payload = signer.verify(signed.token);

    expect(payload.nonce).toBe(signed.nonce);
  });

  it('gives every issued token its own nonce (SDD 13.1: non-enumerable)', () => {
    const signer = buildSigner(new FixedClock(NOW));

    const nonces = new Set(Array.from({ length: 20 }, () => signer.sign(subOrderId).nonce));

    expect(nonces.size).toBe(20);
  });

  it('sets expiresAt exactly ttlSeconds after issuedAt', () => {
    const signer = buildSigner(new FixedClock(NOW));

    const signed = signer.sign(subOrderId);

    expect(signed.issuedAt).toEqual(NOW);
    expect(signed.expiresAt.getTime() - signed.issuedAt.getTime()).toBe(TTL_SECONDS * 1000);
  });

  it('produces a standard three-part compact JWS', () => {
    const signer = buildSigner(new FixedClock(NOW));

    expect(signer.sign(subOrderId).token.split('.')).toHaveLength(3);
  });

  it('a token still within its validity window verifies successfully', () => {
    const clock = new FixedClock(NOW);
    const signer = buildSigner(clock);
    const signed = signer.sign(subOrderId);

    clock.advanceMs((TTL_SECONDS - 1) * 1000);

    expect(() => signer.verify(signed.token)).not.toThrow();
  });

  it('rejects an expired token', () => {
    const clock = new FixedClock(NOW);
    const signer = buildSigner(clock);
    const signed = signer.sign(subOrderId);

    clock.advanceMs(TTL_SECONDS * 1000);

    expect(() => signer.verify(signed.token)).toThrow(PickupTokenInvalidError);
  });

  it('rejects a token signed by a different keypair (forged)', () => {
    const clock = new FixedClock(NOW);
    const signer = buildSigner(clock);
    const verifierWithWrongKey = buildSigner(clock, otherPublicKeyPem);
    const signed = signer.sign(subOrderId);

    expect(() => verifierWithWrongKey.verify(signed.token)).toThrow(PickupTokenInvalidError);
  });

  it('rejects a token whose signature has been tampered with', () => {
    const signer = buildSigner(new FixedClock(NOW));
    const signed = signer.sign(subOrderId);
    const [header, payload] = signed.token.split('.');
    const tampered = `${header}.${payload}.${'A'.repeat(86)}`;

    expect(() => signer.verify(tampered)).toThrow(PickupTokenInvalidError);
  });

  it('rejects a token whose payload has been tampered with (soid swapped for another sub-order)', () => {
    const signer = buildSigner(new FixedClock(NOW));
    const signed = signer.sign(subOrderId);
    const [header, , signature] = signed.token.split('.');
    const forgedPayload = Buffer.from(
      JSON.stringify({
        soid: '00000000-0000-7000-8000-000000000d99',
        nonce: 'x'.repeat(32),
        aud: 'pickup',
        iat: Math.floor(NOW.getTime() / 1000),
        exp: Math.floor(NOW.getTime() / 1000) + TTL_SECONDS,
      }),
    ).toString('base64url');

    expect(() => signer.verify(`${header}.${forgedPayload}.${signature}`)).toThrow(
      PickupTokenInvalidError,
    );
  });

  it('rejects a malformed token (not three dot-separated parts)', () => {
    const signer = buildSigner(new FixedClock(NOW));

    expect(() => signer.verify('not-a-real-token')).toThrow(PickupTokenInvalidError);
  });

  it('rejects an empty string', () => {
    const signer = buildSigner(new FixedClock(NOW));

    expect(() => signer.verify('')).toThrow(PickupTokenInvalidError);
  });

  it('rejects a header claiming a different algorithm (alg-confusion, OWASP A02)', () => {
    const signer = buildSigner(new FixedClock(NOW));
    const signed = signer.sign(subOrderId);
    const [, payload, signature] = signed.token.split('.');
    const wrongAlgHeader = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString(
      'base64url',
    );

    expect(() => signer.verify(`${wrongAlgHeader}.${payload}.${signature}`)).toThrow(
      PickupTokenInvalidError,
    );
  });

  it('every failure collapses to the same uniform error, never distinguishing why (SEC-15)', () => {
    const clock = new FixedClock(NOW);
    const signer = buildSigner(clock);
    const signed = signer.sign(subOrderId);
    clock.advanceMs(TTL_SECONDS * 1000);

    try {
      signer.verify(signed.token);
      expect.unreachable('an expired token should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(PickupTokenInvalidError);
      expect((error as PickupTokenInvalidError).kind).toBe('DOMAIN_RULE');
      expect((error as PickupTokenInvalidError).code).toBe('PICKUP_TOKEN_INVALID');
    }

    try {
      signer.verify('garbage');
      expect.unreachable('a malformed token should have thrown');
    } catch (error) {
      expect((error as PickupTokenInvalidError).code).toBe('PICKUP_TOKEN_INVALID');
    }
  });
});
