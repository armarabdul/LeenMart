import { Prisma, type PrismaClient } from '@prisma/client';
import type { MfaSecretRepository } from '../../domain/repositories/mfa-secret.repository.js';
import { MfaSecret } from '../../domain/entities/mfa-secret.entity.js';
import { MfaSecretAlreadyExistsError } from '../../domain/errors/identity-errors.js';
import {
  toMfaSecretId,
  type MfaSecretId,
} from '../../domain/value-objects/mfa-secret-id.value-object.js';
import { toUserId, type UserId } from '../../domain/value-objects/user-id.value-object.js';

/** Prisma's unique-constraint-violation code — here, always the `userId` constraint (SDD 3.4: Prisma types never escape this file). */
const UNIQUE_CONSTRAINT_VIOLATION = 'P2002';

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
    try {
      await this.prisma.mfaSecret.create({
        data: {
          id: mfaSecret.id,
          userId: mfaSecret.userId,
          encryptedSecret: mfaSecret.encryptedSecret,
          confirmedAt: mfaSecret.confirmedAt,
        },
      });
    } catch (error) {
      // Two concurrent enrollment attempts can both pass the use case's
      // findByUserId check and both reach this insert; the unique
      // constraint on userId is the actual final arbiter, exactly as
      // `consumeIfActive`'s WHERE clause is for MFA challenges. Whichever
      // request loses gets a clean domain error, not a raw Prisma one.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === UNIQUE_CONSTRAINT_VIOLATION
      ) {
        throw new MfaSecretAlreadyExistsError();
      }
      throw error;
    }
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
