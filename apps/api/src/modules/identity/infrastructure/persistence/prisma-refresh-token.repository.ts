import type { PrismaClient } from '@prisma/client';
import { toUuid } from '@leen-mart/domain-kit';
import type { RefreshTokenRepository } from '../../application/ports/refresh-token-repository.port.js';
import { RefreshToken } from '../../domain/entities/refresh-token.entity.js';

interface RefreshTokenRow {
  readonly id: string;
  readonly userId: string;
  readonly tokenHash: string;
  readonly expiresAt: Date;
  readonly revokedAt: Date | null;
  readonly replacedById: string | null;
  readonly createdAt: Date;
}

const toDomain = (row: RefreshTokenRow): RefreshToken =>
  RefreshToken.reconstitute({
    id: toUuid(row.id),
    userId: toUuid(row.userId),
    tokenHash: row.tokenHash,
    expiresAt: row.expiresAt,
    revokedAt: row.revokedAt,
    replacedByTokenId: row.replacedById ? toUuid(row.replacedById) : null,
    createdAt: row.createdAt,
  });

/** Maps rows to `RefreshToken` at the boundary; Prisma types never escape this file (SDD 3.4). */
export class PrismaRefreshTokenRepository implements RefreshTokenRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async create(token: RefreshToken): Promise<void> {
    await this.prisma.refreshToken.create({
      data: {
        id: token.id,
        userId: token.userId,
        tokenHash: token.tokenHash,
        expiresAt: token.expiresAt,
        revokedAt: token.revokedAt,
        replacedById: token.replacedByTokenId,
      },
    });
  }

  async update(token: RefreshToken): Promise<void> {
    await this.prisma.refreshToken.update({
      where: { id: token.id },
      data: {
        revokedAt: token.revokedAt,
        replacedById: token.replacedByTokenId,
      },
    });
  }

  async findByTokenHash(tokenHash: string): Promise<RefreshToken | null> {
    const row = await this.prisma.refreshToken.findUnique({ where: { tokenHash } });
    return row ? toDomain(row) : null;
  }
}
