import * as argon2 from 'argon2';
import type { PasswordHasher } from '../../application/ports/password-hasher.port.js';
import { PasswordHash } from '../../domain/value-objects/password-hash.value-object.js';

export class Argon2PasswordHasher implements PasswordHasher {
  async hash(plaintext: string): Promise<PasswordHash> {
    const hash = await argon2.hash(plaintext, { type: argon2.argon2id });
    return PasswordHash.create(hash);
  }

  async verify(hash: PasswordHash, plaintext: string): Promise<boolean> {
    return await argon2.verify(hash.value, plaintext);
  }
}
