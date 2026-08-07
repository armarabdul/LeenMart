export type CurrencyCode = 'INR';

/**
 * Money as integer minor units (SDD 6.1 / ADR-006).
 *
 * Currency is never a floating-point number. `amountMinor` is paise for INR, so
 * 149900 means Rs. 1,499.00. Arithmetic between different currencies throws
 * rather than silently producing a wrong number.
 */
export class Money {
  private constructor(
    public readonly amountMinor: bigint,
    public readonly currency: CurrencyCode,
  ) {}

  static fromMinor(amountMinor: bigint | number, currency: CurrencyCode = 'INR'): Money {
    const value = typeof amountMinor === 'number' ? BigInt(Math.trunc(amountMinor)) : amountMinor;
    if (typeof amountMinor === 'number' && !Number.isInteger(amountMinor)) {
      throw new TypeError(
        `Money.fromMinor expects an integer number of minor units, received ${String(amountMinor)}`,
      );
    }
    return new Money(value, currency);
  }

  /** Convenience for literals in tests and seed data. Rupees -> paise. */
  static fromMajor(amountMajor: number, currency: CurrencyCode = 'INR'): Money {
    const minor = Math.round(amountMajor * 100);
    if (!Number.isSafeInteger(minor)) {
      throw new RangeError(`Amount out of safe range: ${amountMajor}`);
    }
    return new Money(BigInt(minor), currency);
  }

  static zero(currency: CurrencyCode = 'INR'): Money {
    return new Money(0n, currency);
  }

  private assertSameCurrency(other: Money): void {
    if (this.currency !== other.currency) {
      // `CurrencyCode` is a single-member union today, so TS narrows both
      // sides to `never` inside this (currently unreachable) branch — a
      // consequence of the type, not the runtime value, which is why the
      // interpolation is wrapped rather than the check removed.
      throw new TypeError(`Currency mismatch: ${String(this.currency)} vs ${String(other.currency)}`);
    }
  }

  add(other: Money): Money {
    this.assertSameCurrency(other);
    return new Money(this.amountMinor + other.amountMinor, this.currency);
  }

  subtract(other: Money): Money {
    this.assertSameCurrency(other);
    return new Money(this.amountMinor - other.amountMinor, this.currency);
  }

  multiply(factor: number): Money {
    if (!Number.isInteger(factor)) {
      throw new TypeError('Use percentageOf() for fractional scaling to keep rounding explicit.');
    }
    return new Money(this.amountMinor * BigInt(factor), this.currency);
  }

  /**
   * Half-up percentage, used for commission and tax maths (SDD 10.3).
   *
   * Percent is scaled to four decimal places so rates like 2.5% or 0.1% (TDS
   * under s.194-O) are exact. Rounding is stated explicitly rather than
   * inherited from integer division, because a settlement engine must be able
   * to explain every paisa.
   */
  percentageOf(percent: number): Money {
    const scaledPercent = BigInt(Math.round(percent * 10_000));
    const numerator = this.amountMinor * scaledPercent;
    const denominator = 1_000_000n;
    const negative = numerator < 0n;
    const abs = negative ? -numerator : numerator;
    const rounded = (abs * 2n + denominator) / (denominator * 2n);
    return new Money(negative ? -rounded : rounded, this.currency);
  }

  isZero(): boolean {
    return this.amountMinor === 0n;
  }

  isNegative(): boolean {
    return this.amountMinor < 0n;
  }

  equals(other: Money): boolean {
    return this.currency === other.currency && this.amountMinor === other.amountMinor;
  }

  compare(other: Money): -1 | 0 | 1 {
    this.assertSameCurrency(other);
    if (this.amountMinor < other.amountMinor) return -1;
    if (this.amountMinor > other.amountMinor) return 1;
    return 0;
  }

  /** Wire format used across the API (SDD 9.2). */
  toJSON(): { amount: string; currency: CurrencyCode } {
    return { amount: this.amountMinor.toString(), currency: this.currency };
  }

  toString(): string {
    const negative = this.amountMinor < 0n;
    const abs = negative ? -this.amountMinor : this.amountMinor;
    const major = abs / 100n;
    const minor = (abs % 100n).toString().padStart(2, '0');
    return `${negative ? '-' : ''}${major.toString()}.${minor} ${this.currency}`;
  }
}
