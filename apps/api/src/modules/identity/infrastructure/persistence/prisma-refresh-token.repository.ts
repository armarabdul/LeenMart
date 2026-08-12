import type { PrismaClient } from '@prisma/client';
import type { RefreshTokenRepository } from '../../application/ports/refresh-token-repository.port.js';
import { RefreshToken } from '../../domain/entities/refresh-token.entity.js';
import { toSessionId, type SessionId } from '../../domain/value-objects/session-id.value-object.js';
import { toUserId, type UserId } from '../../domain/value-objects/user-id.value-object.js';

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

  async revokeFamily(familyId: SessionId, now: Date): Promise<readonly SessionId[]> {
    // Select-then-update inside one transaction, rather than a bare
    // `updateMany`: Prisma's `updateMany` reports only a count, and the
    // caller needs the actual ids to deny each dead session's access token
    // (SDD 7.2). The transaction is what keeps the two statements agreeing —
    // without it a concurrent rotation could insert a row between them, which
    // the UPDATE would then kill without the caller ever learning its id, and
    // that session's access token would keep authenticating.
    //
    // Both statements filter `revokedAt: null` over `idx_refresh_tokens_family`,
    // so a replay of the same stolen token returns empty instead of
    // re-stamping tokens that already died.
    return this.prisma.$transaction(async (tx) => {
      const live = await tx.refreshToken.findMany({
        where: { familyId, revokedAt: null },
        select: { id: true },
      });
      if (live.length === 0) return [];

      const ids = live.map((row) => row.id);
      await tx.refreshToken.updateMany({
        where: { id: { in: ids }, revokedAt: null },
        data: { revokedAt: now },
      });
      return ids.map(toSessionId);
    });
  }

  async revokeAllForUser(userId: UserId, now: Date): Promise<readonly SessionId[]> {
    // Same select-then-update-in-one-transaction shape as `revokeFamily`, and
    // for the same reason: the caller needs the ids to deny each dead
    // session's access token, and only a transaction keeps the two statements
    // agreeing about which rows those are.
    return this.prisma.$transaction(async (tx) => {
      const live = await tx.refreshToken.findMany({
        where: { userId, revokedAt: null },
        select: { id: true },
      });
      if (live.length === 0) return [];

      const ids = live.map((row) => row.id);
      await tx.refreshToken.updateMany({
        where: { id: { in: ids }, revokedAt: null },
        data: { revokedAt: now },
      });
      return ids.map(toSessionId);
    });
  }

  async findSessionIdsByUserId(userId: UserId): Promise<readonly SessionId[]> {
    // No `revokedAt` filter, for the same reason `findFamilySessionIds` has
    // none: a session already dead in the database can still hold an access
    // token carrying the stale role.
    const rows = await this.prisma.refreshToken.findMany({
      where: { userId },
      select: { id: true },
    });
    return rows.map((row) => toSessionId(row.id));
  }

  async findFamilySessionIds(familyId: SessionId): Promise<readonly SessionId[]> {
    // No `revokedAt` filter, unlike `revokeFamily`: the point of this read is
    // the sessions that are already dead in the database but whose access
    // tokens have not yet expired.
    const rows = await this.prisma.refreshToken.findMany({
      where: { familyId },
      select: { id: true },
    });
    return rows.map((row) => toSessionId(row.id));
  }
}
