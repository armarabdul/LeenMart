import type { PrismaClient } from '@prisma/client';
import type { OtpRepository } from '../../domain/repositories/otp.repository.js';
import { Otp } from '../../domain/entities/otp.entity.js';
import { toOtpId, type OtpId } from '../../domain/value-objects/otp-id.value-object.js';
import { toUserId, type UserId } from '../../domain/value-objects/user-id.value-object.js';

interface OtpRow {
  readonly id: string;
  readonly userId: string;
  readonly codeHash: string;
  readonly attempts: number;
  readonly expiresAt: Date;
  readonly consumedAt: Date | null;
  readonly createdAt: Date;
}

const toDomain = (row: OtpRow): Otp =>
  Otp.reconstitute({
    id: toOtpId(row.id),
    userId: toUserId(row.userId),
    codeHash: row.codeHash,
    attempts: row.attempts,
    expiresAt: row.expiresAt,
    consumedAt: row.consumedAt,
    createdAt: row.createdAt,
  });

/** Maps rows to `Otp` at the boundary; Prisma types never escape this file (SDD 3.4). */
export class PrismaOtpRepository implements OtpRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async create(otp: Otp): Promise<void> {
    await this.prisma.otp.create({
      data: {
        id: otp.id,
        userId: otp.userId,
        codeHash: otp.codeHash,
        attempts: otp.attempts,
        expiresAt: otp.expiresAt,
        consumedAt: otp.consumedAt,
      },
    });
  }

  async update(otp: Otp): Promise<void> {
    await this.prisma.otp.update({
      where: { id: otp.id },
      data: {
        attempts: otp.attempts,
        consumedAt: otp.consumedAt,
      },
    });
  }

  async findById(id: OtpId): Promise<Otp | null> {
    const row = await this.prisma.otp.findUnique({ where: { id } });
    return row ? toDomain(row) : null;
  }

  async findActiveByUserId(userId: UserId): Promise<Otp | null> {
    const row = await this.prisma.otp.findFirst({
      where: { userId, consumedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    return row ? toDomain(row) : null;
  }
}
