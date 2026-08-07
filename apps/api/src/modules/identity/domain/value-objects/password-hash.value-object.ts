import { InvalidPasswordError } from '../errors/identity-errors.js';

// Real password hashes (argon2id, bcrypt, scrypt...) are always far longer
// than this; it exists only to catch an empty string or an accidental
// plaintext password being passed where a hash is required.
const MIN_HASH_LENGTH = 20;

/**
 * An already-hashed password. There is no factory that accepts plaintext —
 * hashing is an infrastructure concern (Argon2), so this type only ever
 * wraps a value infrastructure has already produced.
 */
export class PasswordHash {
  private constructor(public readonly value: string) {}

  static create(value: string): PasswordHash {
    if (value.trim().length < MIN_HASH_LENGTH) {
      throw new InvalidPasswordError({
        details: [{ field: 'passwordHash', issue: 'must be a hashed value, never empty or plaintext' }],
      });
    }
    return new PasswordHash(value);
  }

  equals(other: PasswordHash): boolean {
    return this.value === other.value;
  }
}
