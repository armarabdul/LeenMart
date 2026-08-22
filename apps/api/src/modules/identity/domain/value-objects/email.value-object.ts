import { InvalidEmailError } from '../errors/identity-errors.js';

// Structural check, not deliverability: good enough to reject obvious
// garbage while staying independent of the interface layer's Zod schema
// (domain must not depend on packages/contracts).
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_EMAIL_LENGTH = 254; // RFC 5321 §4.5.3.1.3

/** A verified-format, normalised email address. Optional on `User` — customers authenticate by phone. */
export class Email {
  private constructor(public readonly value: string) {}

  static create(value: string): Email {
    const normalized = value.trim().toLowerCase();
    if (
      normalized.length === 0 ||
      normalized.length > MAX_EMAIL_LENGTH ||
      !EMAIL_PATTERN.test(normalized)
    ) {
      throw new InvalidEmailError({
        details: [{ field: 'email', issue: 'must be a valid email address' }],
      });
    }
    return new Email(normalized);
  }

  equals(other: Email): boolean {
    return this.value === other.value;
  }

  toString(): string {
    return this.value;
  }
}
