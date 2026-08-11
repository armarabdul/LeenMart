import type { PrismaClient } from '@prisma/client';
import type { MfaChallengeRepository } from '../../domain/repositories/mfa-challenge.repository.js';
import { MfaChallenge } from '../../domain/entities/mfa-challenge.entity.js';
import {
  toMfaChallengeId,
  type MfaChallengeId,
} from '../../domain/value-objects/mfa-challenge-id.value-object.js';
import { toUserId } from '../../domain/value-objects/user-id.value-object.js';

interface MfaChallengeRow {
  readonly id: string;
  readonly userId: string;
  readonly tokenHash: string;
  readonly attempts: number;
  readonly expiresAt: Date;
  readonly consumedAt: Date | null;
  readonly createdAt: Date;
}

const toDomain = (row: MfaChallengeRow): MfaChallenge =>
  MfaChallenge.reconstitute({
    id: toMfaChallengeId(row.id),
    userId: toUserId(row.userId),
    tokenHash: row.tokenHash,
    attempts: row.attempts,
    expiresAt: row.expiresAt,
    consumedAt: row.consumedAt,
    createdAt: row.createdAt,
  });

/** Maps rows to `MfaChallenge` at the boundary; Prisma types never escape this file (SDD 3.4). */
export class PrismaMfaChallengeRepository implements MfaChallengeRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async create(mfaChallenge: MfaChallenge): Promise<void> {
    await this.prisma.mfaChallenge.create({
      data: {
        id: mfaChallenge.id,
        userId: mfaChallenge.userId,
        tokenHash: mfaChallenge.tokenHash,
        attempts: mfaChallenge.attempts,
        expiresAt: mfaChallenge.expiresAt,
        consumedAt: mfaChallenge.consumedAt,
      },
    });
  }

  async update(mfaChallenge: MfaChallenge): Promise<void> {
    await this.prisma.mfaChallenge.update({
      where: { id: mfaChallenge.id },
      data: {
        attempts: mfaChallenge.attempts,
        consumedAt: mfaChallenge.consumedAt,
      },
    });
  }

  async findByTokenHash(tokenHash: string): Promise<MfaChallenge | null> {
    const row = await this.prisma.mfaChallenge.findUnique({ where: { tokenHash } });
    return row ? toDomain(row) : null;
  }

  async consumeIfActive(id: MfaChallengeId, now: Date): Promise<boolean> {
    // One conditional UPDATE, not a read-then-write: the WHERE clause is the
    // atomicity guarantee. Two concurrent callers racing this statement can
    // each match at most a disjoint view of the row — only one `UPDATE` can
    // actually flip `consumed_at` from null, so `count` tells the caller,
    // unambiguously, whether *this* call was the one that won.
    const result = await this.prisma.mfaChallenge.updateMany({
      where: {
        id,
        consumedAt: null,
        attempts: { lt: MfaChallenge.MAX_ATTEMPTS },
        expiresAt: { gt: now },
      },
      data: { consumedAt: now },
    });
    return result.count === 1;
  }
}
