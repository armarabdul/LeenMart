import type { PrismaClient } from '@prisma/client';
import type { MfaSecretRepository } from '../../domain/repositories/mfa-secret.repository.js';
import { MfaSecret } from '../../domain/entities/mfa-secret.entity.js';
import {
  toMfaSecretId,
  type MfaSecretId,
} from '../../domain/value-objects/mfa-secret-id.value-object.js';
import { toUserId, type UserId } from '../../domain/value-objects/user-id.value-object.js';

interface MfaSecretRow {
  readonly id: string;
  readonly userId: string;
  readonly encryptedSecret: string;
  readonly confirmedAt: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

const toDomain = (row: MfaSecretRow): MfaSecret =>
  MfaSecret.reconstitute({
    id: toMfaSecretId(row.id),
    userId: toUserId(row.userId),
    encryptedSecret: row.encryptedSecret,
    confirmedAt: row.confirmedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });

/** Maps rows to `MfaSecret` at the boundary; Prisma types never escape this file (SDD 3.4). */
export class PrismaMfaSecretRepository implements MfaSecretRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async create(mfaSecret: MfaSecret): Promise<void> {
    await this.prisma.mfaSecret.create({
      data: {
        id: mfaSecret.id,
        userId: mfaSecret.userId,
        encryptedSecret: mfaSecret.encryptedSecret,
        confirmedAt: mfaSecret.confirmedAt,
      },
    });
  }

  async update(mfaSecret: MfaSecret): Promise<void> {
    await this.prisma.mfaSecret.update({
      where: { id: mfaSecret.id },
      data: {
        encryptedSecret: mfaSecret.encryptedSecret,
        confirmedAt: mfaSecret.confirmedAt,
      },
    });
  }

  async findById(id: MfaSecretId): Promise<MfaSecret | null> {
    const row = await this.prisma.mfaSecret.findUnique({ where: { id } });
    return row ? toDomain(row) : null;
  }

  async findByUserId(userId: UserId): Promise<MfaSecret | null> {
    const row = await this.prisma.mfaSecret.findUnique({ where: { userId } });
    return row ? toDomain(row) : null;
  }
}
