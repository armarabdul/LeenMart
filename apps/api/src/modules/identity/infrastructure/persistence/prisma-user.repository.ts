import type { TransactionScope } from '@leen-mart/domain-kit';
import type { PrismaClient } from '@prisma/client';
import { toUserId, type UserId } from '../../domain/value-objects/user-id.value-object.js';
import type { UserRepository } from '../../application/ports/user-repository.port.js';
import type { AdminUserPage } from '../../domain/repositories/user.repository.js';
import {
  ADMIN_ROLE_NAMES,
  Role,
  type RoleName,
} from '../../domain/value-objects/role.value-object.js';
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

  /**
   * Unwraps the opaque scope back into the Prisma transaction client it
   * actually is. The cast is confined to this layer on purpose: the port
   * cannot name `PrismaClient` (SDD 2.3 forbids the domain and application
   * layers from importing Prisma), and the only way to obtain a
   * `TransactionScope` is from `TransactionRunner.run`, so nothing else can
   * fabricate one.
   */
  withTransaction(scope: TransactionScope): UserRepository {
    return new PrismaUserRepository(scope as unknown as PrismaClient);
  }

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

  async update(user: User): Promise<void> {
    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        // `role` joins the narrow field list because vendor registration
        // promotes CUSTOMER → VENDOR_OWNER (SDD 8.1) and that transition has
        // nowhere else to be written. Safe for every other caller: they load
        // the user first, so the value they write back is the one already
        // stored.
        role: user.role.name,
        status: user.status.name,
        phoneVerifiedAt: user.phoneVerifiedAt,
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

  async existsWithAnyRole(roles: readonly RoleName[]): Promise<boolean> {
    // `findFirst` with a bare id selection rather than `count`: the caller
    // only asks whether one exists, and Postgres can stop at the first row.
    const row = await this.prisma.user.findFirst({
      where: { role: { in: [...roles] }, deletedAt: null },
      select: { id: true },
    });
    return row !== null;
  }

  async listAdmins(input: { limit: number; cursor?: string }): Promise<AdminUserPage> {
    // One row beyond the page, so `hasMore` is an observation rather than a
    // second count query — the same trick `PrismaCategoryRepository.listPage`
    // uses, on the same UUID-v7-is-a-total-order reasoning.
    const take = input.limit + 1;
    const rows = await this.prisma.user.findMany({
      where: { role: { in: [...ADMIN_ROLE_NAMES] }, deletedAt: null },
      orderBy: { id: 'asc' },
      take,
      ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
    });

    const hasMore = rows.length > input.limit;
    const page = hasMore ? rows.slice(0, input.limit) : rows;

    return {
      items: page.map(toDomain),
      nextCursor: hasMore ? (page[page.length - 1]?.id ?? null) : null,
      hasMore,
    };
  }
}
