import * as argon2 from 'argon2';
import type { PasswordHasher } from '../../application/ports/password-hasher.port.js';

export class Argon2PasswordHasher implements PasswordHasher {
  async hash(plaintext: string): Promise<string> {
    return await argon2.hash(plaintext, { type: argon2.argon2id });
  }

  async verify(hash: string, plaintext: string): Promise<boolean> {
    return await argon2.verify(hash, plaintext);
  }
}
