import { describe, expect, it } from 'vitest';
import { Argon2PasswordHasher } from '../../../../../src/modules/identity/infrastructure/security/argon2-password-hasher.js';

describe('Argon2PasswordHasher', () => {
  it('produces an argon2id hash distinct from the plaintext', async () => {
    const hasher = new Argon2PasswordHasher();

    const hash = await hasher.hash('correct horse battery staple');

    expect(hash).not.toBe('correct horse battery staple');
    expect(hash).toMatch(/^\$argon2id\$/);
  });

  it('verifies a matching password', async () => {
    const hasher = new Argon2PasswordHasher();
    const hash = await hasher.hash('correct horse battery staple');

    await expect(hasher.verify(hash, 'correct horse battery staple')).resolves.toBe(true);
  });

  it('rejects a non-matching password', async () => {
    const hasher = new Argon2PasswordHasher();
    const hash = await hasher.hash('correct horse battery staple');

    await expect(hasher.verify(hash, 'wrong password')).resolves.toBe(false);
  });

  it('salts each hash independently, so hashing the same password twice differs', async () => {
    const hasher = new Argon2PasswordHasher();

    const [first, second] = await Promise.all([
      hasher.hash('correct horse battery staple'),
      hasher.hash('correct horse battery staple'),
    ]);

    expect(first).not.toBe(second);
  });
});
