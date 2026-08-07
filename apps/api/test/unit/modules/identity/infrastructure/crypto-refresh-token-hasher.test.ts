import { describe, expect, it } from 'vitest';
import { CryptoRefreshTokenHasher } from '../../../../../src/modules/identity/infrastructure/security/crypto-refresh-token-hasher.js';

describe('CryptoRefreshTokenHasher', () => {
  it('generates high-entropy tokens that never repeat', () => {
    const hasher = new CryptoRefreshTokenHasher();

    const tokens = new Set(Array.from({ length: 100 }, () => hasher.generate()));

    expect(tokens.size).toBe(100);
    for (const token of tokens) {
      expect(token).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it('hashes deterministically, so the same raw token always looks up the same row', () => {
    const hasher = new CryptoRefreshTokenHasher();
    const raw = hasher.generate();

    expect(hasher.hash(raw)).toBe(hasher.hash(raw));
  });

  it('never stores the raw token as its own hash', () => {
    const hasher = new CryptoRefreshTokenHasher();
    const raw = hasher.generate();

    expect(hasher.hash(raw)).not.toBe(raw);
  });
});
