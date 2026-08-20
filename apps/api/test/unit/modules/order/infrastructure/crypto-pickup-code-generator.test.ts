import { describe, expect, it, vi } from 'vitest';
import type * as CryptoModule from 'node:crypto';

// Same reasoning as `crypto-otp-generator.test.ts`'s own `vi.hoisted` — pins
// `randomInt` to the one two-argument, synchronous overload this file uses.
const randomIntMock = vi.hoisted(() => vi.fn<(min: number, max: number) => number>());

vi.mock('node:crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof CryptoModule>();
  randomIntMock.mockImplementation(actual.randomInt);
  return { ...actual, randomInt: randomIntMock };
});

import { CryptoPickupCodeGenerator } from '../../../../../src/modules/order/infrastructure/crypto/crypto-pickup-code-generator.js';

describe('CryptoPickupCodeGenerator', () => {
  it('generates a four-digit, numeric-only code', () => {
    const generator = new CryptoPickupCodeGenerator();

    const code = generator.generate();

    expect(code).toMatch(/^\d{4}$/);
  });

  it('preserves leading zeroes when the underlying random value is small', () => {
    randomIntMock.mockReturnValueOnce(7);
    const generator = new CryptoPickupCodeGenerator();

    expect(generator.generate()).toBe('0007');
  });

  it('preserves an all-zero value too', () => {
    randomIntMock.mockReturnValueOnce(0);
    const generator = new CryptoPickupCodeGenerator();

    expect(generator.generate()).toBe('0000');
  });

  it('draws from the full [0, 10000) range, not a biased subset', () => {
    const generator = new CryptoPickupCodeGenerator();

    generator.generate();

    expect(randomIntMock).toHaveBeenLastCalledWith(0, 10_000);
  });

  it('does not repeat across a reasonable sample', () => {
    const generator = new CryptoPickupCodeGenerator();

    const codes = new Set(Array.from({ length: 50 }, () => generator.generate()));

    // 50 draws from a 10,000-value space colliding is plausible but low
    // (birthday-bound ~11%); a fixed-value generator would collapse this to
    // size 1, which is what this actually guards against.
    expect(codes.size).toBeGreaterThan(1);
  });
});
