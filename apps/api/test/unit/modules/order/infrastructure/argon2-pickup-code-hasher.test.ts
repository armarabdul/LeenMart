import { describe, expect, it } from 'vitest';
import { Argon2PickupCodeHasher } from '../../../../../src/modules/order/infrastructure/security/argon2-pickup-code-hasher.js';

describe('Argon2PickupCodeHasher', () => {
  it('never stores the raw code as its own hash', async () => {
    const hasher = new Argon2PickupCodeHasher();

    const hash = await hasher.hash('4281');

    expect(hash).not.toBe('4281');
    expect(hash).toMatch(/^\$argon2id\$/);
  });

  it('verifies a matching code', async () => {
    const hasher = new Argon2PickupCodeHasher();
    const hash = await hasher.hash('4281');

    await expect(hasher.verify(hash, '4281')).resolves.toBe(true);
  });

  it('rejects a non-matching code', async () => {
    const hasher = new Argon2PickupCodeHasher();
    const hash = await hasher.hash('4281');

    await expect(hasher.verify(hash, '9999')).resolves.toBe(false);
  });

  it('salts each hash independently, so hashing the same code twice differs', async () => {
    const hasher = new Argon2PickupCodeHasher();

    const [first, second] = await Promise.all([hasher.hash('4281'), hasher.hash('4281')]);

    expect(first).not.toBe(second);
  });
});
