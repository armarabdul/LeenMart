import type { PrismaClient } from '@prisma/client';
import type { MfaChallengeRepository } from '../../domain/repositories/mfa-challenge.repository.js';
import { MfaChallenge } from '../../domain/entities/mfa-challenge.entity.js';
import { toMfaChallengeId } from '../../domain/value-objects/mfa-challenge-id.value-object.js';
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
}
