import { describe, expect, it } from 'vitest';
import { Argon2OtpHasher } from '../../../../../src/modules/identity/infrastructure/security/argon2-otp-hasher.js';

describe('Argon2OtpHasher', () => {
  it('never stores the raw code as its own hash', async () => {
    const hasher = new Argon2OtpHasher();

    const hash = await hasher.hash('004281');

    expect(hash).not.toBe('004281');
    expect(hash).toMatch(/^\$argon2id\$/);
  });

  it('verifies a matching code', async () => {
    const hasher = new Argon2OtpHasher();
    const hash = await hasher.hash('004281');

    await expect(hasher.verify(hash, '004281')).resolves.toBe(true);
  });

  it('rejects a non-matching code', async () => {
    const hasher = new Argon2OtpHasher();
    const hash = await hasher.hash('004281');

    await expect(hasher.verify(hash, '999999')).resolves.toBe(false);
  });

  it('salts each hash independently, so hashing the same code twice differs', async () => {
    const hasher = new Argon2OtpHasher();

    const [first, second] = await Promise.all([hasher.hash('004281'), hasher.hash('004281')]);

    expect(first).not.toBe(second);
  });
});
