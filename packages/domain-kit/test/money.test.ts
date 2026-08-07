import { describe, expect, it } from 'vitest';
import { type CurrencyCode, Money } from '../src/primitives/money.js';

describe('Money', () => {
  it('stores rupees as integer paise', () => {
    expect(Money.fromMajor(1499).amountMinor).toBe(149_900n);
    expect(Money.fromMinor(149_900n).toString()).toBe('1499.00 INR');
  });

  it('rejects a fractional minor-unit amount', () => {
    expect(() => Money.fromMinor(10.5)).toThrow(TypeError);
  });

  it('adds and subtracts without floating-point drift', () => {
    const total = Money.fromMajor(0.1).add(Money.fromMajor(0.2));
    expect(total.equals(Money.fromMajor(0.3))).toBe(true);
    expect(total.amountMinor).toBe(30n);
  });

  it('refuses arithmetic that would silently produce a wrong number', () => {
    const inr = Money.fromMajor(100);
    const foreign = Money.fromMinor(10_000n, 'USD' as CurrencyCode);
    expect(() => inr.add(foreign)).toThrow(/Currency mismatch/);
  });

  it('computes a whole percentage exactly', () => {
    expect(Money.fromMajor(1000).percentageOf(10).amountMinor).toBe(10_000n);
  });

  it('computes a fractional percentage with half-up rounding', () => {
    // 0.1% TDS on Rs. 1,499.00 = Rs. 1.499 -> 150 paise (half-up).
    expect(Money.fromMajor(1499).percentageOf(0.1).amountMinor).toBe(150n);
    // 1% TCS on Rs. 999.99 = Rs. 9.9999 -> 1000 paise.
    expect(Money.fromMajor(999.99).percentageOf(1).amountMinor).toBe(1_000n);
  });

  it('orders and compares values', () => {
    expect(Money.fromMajor(10).compare(Money.fromMajor(20))).toBe(-1);
    expect(Money.fromMajor(20).compare(Money.fromMajor(10))).toBe(1);
    expect(Money.fromMajor(10).compare(Money.fromMajor(10))).toBe(0);
  });

  it('serialises the amount as a string to survive JSON', () => {
    expect(Money.fromMajor(1499).toJSON()).toEqual({ amount: '149900', currency: 'INR' });
  });
});
