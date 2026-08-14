import type { PrismaClient } from '@prisma/client';
import type { TransactionScope } from '@leen-mart/domain-kit';
import { toUserId, type UserId } from '../../../identity/index.js';
import { Cart } from '../../domain/entities/cart.entity.js';
import type { CartRepository } from '../../domain/repositories/cart.repository.js';
import { toCartId } from '../../domain/value-objects/cart-id.value-object.js';

interface CartRow {
  readonly id: string;
  readonly userId: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

const toDomain = (row: CartRow): Cart =>
  Cart.reconstitute({
    id: toCartId(row.id),
    userId: toUserId(row.userId),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });

/**
 * Maps rows to `Cart` at the boundary; Prisma types never escape this file
 * (SDD 3.4). Plain `PrismaClient`, no RLS/tenant handling — `carts` is
 * outside `TENANT_SCOPED_MODELS`, the same convention `PrismaAddressRepository`
 * establishes for customer-owned (non-vendor-tenant) resources.
 */
export class PrismaCartRepository implements CartRepository {
  constructor(private readonly prisma: PrismaClient) {}

  withTransaction(scope: TransactionScope): CartRepository {
    return new PrismaCartRepository(scope as unknown as PrismaClient);
  }

  async findByUserId(userId: UserId): Promise<Cart | null> {
    const row = await this.prisma.cart.findUnique({ where: { userId } });
    return row ? toDomain(row) : null;
  }

  async upsertForUser(candidate: Cart): Promise<Cart> {
    // `upsert` compiles to `INSERT ... ON CONFLICT (user_id) DO UPDATE`,
    // atomic at the database level (`uq_carts_user` is the arbiter) — no
    // hand-rolled "find, then create if absent" race to get wrong. The
    // candidate's id/timestamps are only used if this call wins the race to
    // create; a loser's `update: {}` is a genuine no-op and its row (with the
    // winner's id) is what comes back.
    const row = await this.prisma.cart.upsert({
      where: { userId: candidate.userId },
      create: {
        id: candidate.id,
        userId: candidate.userId,
        createdAt: candidate.createdAt,
        updatedAt: candidate.updatedAt,
      },
      update: {},
    });
    return toDomain(row);
  }
}
