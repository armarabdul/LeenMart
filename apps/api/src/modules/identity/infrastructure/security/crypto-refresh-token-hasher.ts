import { createHash, randomBytes } from 'node:crypto';
import type { RefreshTokenHasher } from '../../application/ports/refresh-token-hasher.port.js';

const TOKEN_BYTES = 32;

export class CryptoRefreshTokenHasher implements RefreshTokenHasher {
  generate(): string {
    return randomBytes(TOKEN_BYTES).toString('hex');
  }

  hash(rawToken: string): string {
    return createHash('sha256').update(rawToken).digest('hex');
  }
}
