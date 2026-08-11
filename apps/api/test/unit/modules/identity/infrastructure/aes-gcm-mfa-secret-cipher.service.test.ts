import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { AesGcmMfaSecretCipher } from '../../../../../src/modules/identity/infrastructure/security/aes-gcm-mfa-secret-cipher.service.js';

const KEY = randomBytes(32);
const PLAINTEXT = 'JBSWY3DPEHPK3PXP'; // a base32-shaped example secret, not a real one

describe('AesGcmMfaSecretCipher', () => {
  it('round-trips the original plaintext through encrypt/decrypt', () => {
    const cipher = new AesGcmMfaSecretCipher(KEY);

    const ciphertext = cipher.encrypt(PLAINTEXT);

    expect(cipher.decrypt(ciphertext)).toBe(PLAINTEXT);
  });

  it('never stores the plaintext as its own ciphertext', () => {
    const cipher = new AesGcmMfaSecretCipher(KEY);

    const ciphertext = cipher.encrypt(PLAINTEXT);

    expect(ciphertext).not.toBe(PLAINTEXT);
    expect(ciphertext).not.toContain(PLAINTEXT);
  });

  it('produces different ciphertext for the same plaintext each time (random IV)', () => {
    const cipher = new AesGcmMfaSecretCipher(KEY);

    const first = cipher.encrypt(PLAINTEXT);
    const second = cipher.encrypt(PLAINTEXT);

    expect(first).not.toBe(second);
    expect(cipher.decrypt(first)).toBe(PLAINTEXT);
    expect(cipher.decrypt(second)).toBe(PLAINTEXT);
  });

  it('refuses to decrypt with the wrong key', () => {
    const cipher = new AesGcmMfaSecretCipher(KEY);
    const otherCipher = new AesGcmMfaSecretCipher(randomBytes(32));

    const ciphertext = cipher.encrypt(PLAINTEXT);

    expect(() => otherCipher.decrypt(ciphertext)).toThrow();
  });

  it('refuses to decrypt tampered ciphertext', () => {
    const cipher = new AesGcmMfaSecretCipher(KEY);
    const ciphertext = cipher.encrypt(PLAINTEXT);
    const blob = Buffer.from(ciphertext, 'base64');
    blob[blob.length - 1] = (blob[blob.length - 1] ?? 0) ^ 0xff;
    const tampered = blob.toString('base64');

    expect(() => cipher.decrypt(tampered)).toThrow();
  });

  it('refuses to decrypt a truncated blob', () => {
    const cipher = new AesGcmMfaSecretCipher(KEY);

    expect(() => cipher.decrypt(Buffer.from('too-short').toString('base64'))).toThrow();
  });

  it.each([16, 31, 33, 64])('refuses a key that is not exactly 32 bytes (got %i)', (length) => {
    expect(() => new AesGcmMfaSecretCipher(randomBytes(length))).toThrow(RangeError);
  });

  it('never includes the plaintext in a thrown error message', () => {
    const cipher = new AesGcmMfaSecretCipher(KEY);
    const otherCipher = new AesGcmMfaSecretCipher(randomBytes(32));
    const ciphertext = cipher.encrypt(PLAINTEXT);

    try {
      otherCipher.decrypt(ciphertext);
      throw new Error('expected decrypt to throw');
    } catch (error) {
      expect((error as Error).message).not.toContain(PLAINTEXT);
    }
  });
});
