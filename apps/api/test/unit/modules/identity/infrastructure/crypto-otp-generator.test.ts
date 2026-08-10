import { describe, expect, it, vi } from 'vitest';
import type * as CryptoModule from 'node:crypto';

// Explicitly typed to the one two-argument, synchronous overload this file
// actually uses — `randomInt`'s full overload set (sync/async, 1-3 args)
// otherwise leaves `mockReturnValueOnce` ambiguous. `vi.hoisted` is Vitest's
// documented way to give a hoisted `vi.mock` factory a reference the test
// body can also use with its own, unambiguous type.
const randomIntMock = vi.hoisted(() => vi.fn<(min: number, max: number) => number>());

vi.mock('node:crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof CryptoModule>();
  randomIntMock.mockImplementation(actual.randomInt);
  return { ...actual, randomInt: randomIntMock };
});

import { CryptoOtpGenerator } from '../../../../../src/modules/identity/infrastructure/security/crypto-otp-generator.js';
import { OtpCode } from '../../../../../src/modules/identity/domain/value-objects/otp-code.value-object.js';

describe('CryptoOtpGenerator', () => {
  it('generates a six-digit, numeric-only OtpCode', () => {
    const generator = new CryptoOtpGenerator();

    const code = generator.generate();

    expect(code.value).toMatch(/^\d{6}$/);
  });

  it('preserves leading zeroes when the underlying random value is small', () => {
    randomIntMock.mockReturnValueOnce(4281);
    const generator = new CryptoOtpGenerator();

    expect(generator.generate().value).toBe('004281');
  });

  it('preserves an all-zero value too', () => {
    randomIntMock.mockReturnValueOnce(0);
    const generator = new CryptoOtpGenerator();

    expect(generator.generate().value).toBe('000000');
  });

  it('draws from the full range, not a biased subset', () => {
    const generator = new CryptoOtpGenerator();

    // Not a statistical flakiness bet: this asserts the real `randomInt`
    // was actually called with the documented [0, 1_000_000) bounds, which
    // is what guarantees uniformity — not the sampled values themselves.
    generator.generate();

    expect(randomIntMock).toHaveBeenLastCalledWith(0, 1_000_000);
  });

  it('does not repeat across a reasonable sample', () => {
    const generator = new CryptoOtpGenerator();

    const codes = new Set(Array.from({ length: 50 }, () => generator.generate().value));

    // 50 draws from a 1,000,000-value space colliding is negligible
    // (birthday-bound ~0.1%); this is not a statistical randomness test,
    // just confirms the generator isn't stuck returning a fixed value.
    expect(codes.size).toBe(50);
  });

  it("returns a value the domain's own OtpCode.create() accepts without modification", () => {
    const generator = new CryptoOtpGenerator();

    const code = generator.generate();

    expect(() => OtpCode.create(code.value)).not.toThrow();
    expect(OtpCode.create(code.value).equals(code)).toBe(true);
  });
});
