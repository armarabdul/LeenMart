import type { RefreshToken } from '../../domain/entities/refresh-token.entity.js';

export interface RefreshTokenRepository {
  create(token: RefreshToken): Promise<void>;
  update(token: RefreshToken): Promise<void>;
  findByTokenHash(tokenHash: string): Promise<RefreshToken | null>;
}
