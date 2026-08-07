import { InvalidPhoneError } from '../errors/identity-errors.js';

// E.164, India-only (ASM-01) — mirrors packages/contracts's phoneSchema so
// the same number is accepted end to end, without the domain depending on
// that (interface-layer) package.
const PHONE_PATTERN = /^\+91[6-9]\d{9}$/;

/** A verified Indian mobile number. Primary authentication factor for customers. */
export class PhoneNumber {
  private constructor(public readonly value: string) {}

  static create(value: string): PhoneNumber {
    const normalized = value.trim();
    if (!PHONE_PATTERN.test(normalized)) {
      throw new InvalidPhoneError({
        details: [{ field: 'phone', issue: 'must be a valid Indian mobile number in E.164 format (+91XXXXXXXXXX)' }],
      });
    }
    return new PhoneNumber(normalized);
  }

  equals(other: PhoneNumber): boolean {
    return this.value === other.value;
  }

  toString(): string {
    return this.value;
  }
}
