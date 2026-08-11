import type { PrismaClient } from '@prisma/client';
import type { RefreshTokenRepository } from '../../application/ports/refresh-token-repository.port.js';
import { RefreshToken } from '../../domain/entities/refresh-token.entity.js';
import { toSessionId, type SessionId } from '../../domain/value-objects/session-id.value-object.js';
import { toUserId } from '../../domain/value-objects/user-id.value-object.js';

interface RefreshTokenRow {
  readonly id: string;
  readonly userId: string;
  readonly familyId: string;
  readonly tokenHash: string;
  readonly expiresAt: Date;
  readonly revokedAt: Date | null;
  readonly replacedById: string | null;
  readonly createdAt: Date;
}

const toDomain = (row: RefreshTokenRow): RefreshToken =>
  RefreshToken.reconstitute({
    id: toSessionId(row.id),
    userId: toUserId(row.userId),
    familyId: toSessionId(row.familyId),
    tokenHash: row.tokenHash,
    expiresAt: row.expiresAt,
    revokedAt: row.revokedAt,
    replacedByTokenId: row.replacedById ? toSessionId(row.replacedById) : null,
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
        familyId: token.familyId,
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

  async revokeFamily(familyId: SessionId, now: Date): Promise<number> {
    // One conditional UPDATE over `idx_refresh_tokens_family`, not a walk of
    // `replaced_by_id`. `revokedAt: null` in the WHERE clause keeps the write
    // to rows that are actually still live, so the returned count is the
    // number of sessions this call killed rather than the family's size, and
    // a second replay of the same stolen token reports zero instead of
    // re-stamping tokens that already died.
    const result = await this.prisma.refreshToken.updateMany({
      where: { familyId, revokedAt: null },
      data: { revokedAt: now },
    });
    return result.count;
  }
}
