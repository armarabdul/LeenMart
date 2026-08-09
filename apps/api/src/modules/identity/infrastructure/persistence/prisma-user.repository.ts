import type { PrismaClient } from '@prisma/client';
import { toUserId, type UserId } from '../../domain/value-objects/user-id.value-object.js';
import type { UserRepository } from '../../application/ports/user-repository.port.js';
import { Role } from '../../domain/value-objects/role.value-object.js';
import { User } from '../../domain/entities/user.entity.js';
import { PasswordHash } from '../../domain/value-objects/password-hash.value-object.js';
import { PhoneNumber } from '../../domain/value-objects/phone-number.value-object.js';
import { UserStatus } from '../../domain/value-objects/user-status.value-object.js';

interface UserRow {
  readonly id: string;
  readonly email: string | null;
  readonly passwordHash: string | null;
  readonly phone: string | null;
  readonly phoneVerifiedAt: Date | null;
  readonly role: string;
  readonly status: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

const toDomain = (row: UserRow): User =>
  User.reconstitute({
    id: toUserId(row.id),
    ...(row.email ? { email: row.email } : {}),
    ...(row.passwordHash ? { passwordHash: PasswordHash.create(row.passwordHash) } : {}),
    ...(row.phone ? { phone: PhoneNumber.create(row.phone) } : {}),
    phoneVerifiedAt: row.phoneVerifiedAt,
    role: Role.fromName(row.role),
    status: UserStatus.fromName(row.status),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });

/** Maps rows to `User` at the boundary; Prisma types never escape this file (SDD 3.4). */
export class PrismaUserRepository implements UserRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async create(user: User): Promise<void> {
    await this.prisma.user.create({
      data: {
        id: user.id,
        email: user.email ?? null,
        passwordHash: user.passwordHash?.value ?? null,
        phone: user.phone?.value ?? null,
        phoneVerifiedAt: user.phoneVerifiedAt,
        role: user.role.name,
        status: user.status.name,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
      },
    });
  }

  async findByEmail(email: string): Promise<User | null> {
    const row = await this.prisma.user.findFirst({ where: { email, deletedAt: null } });
    return row ? toDomain(row) : null;
  }

  async findByPhone(phone: PhoneNumber): Promise<User | null> {
    const row = await this.prisma.user.findFirst({
      where: { phone: phone.value, deletedAt: null },
    });
    return row ? toDomain(row) : null;
  }

  async findById(id: UserId): Promise<User | null> {
    const row = await this.prisma.user.findFirst({ where: { id, deletedAt: null } });
    return row ? toDomain(row) : null;
  }
}
