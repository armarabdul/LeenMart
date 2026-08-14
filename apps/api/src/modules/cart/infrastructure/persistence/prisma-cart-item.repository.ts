import { Prisma, type PrismaClient } from '@prisma/client';
import type { TransactionScope } from '@leen-mart/domain-kit';
import { toProductVariantId, type ProductVariantId } from '../../../catalogue/index.js';
import { CartItem } from '../../domain/entities/cart-item.entity.js';
import { CartWriteConflictError } from '../../domain/errors/cart-errors.js';
import type { CartItemRepository } from '../../domain/repositories/cart-item.repository.js';
import { toCartId, type CartId } from '../../domain/value-objects/cart-id.value-object.js';
import {
  toCartItemId,
  type CartItemId,
} from '../../domain/value-objects/cart-item-id.value-object.js';

/** Prisma's unique-constraint-violation code — here, always `uq_cart_items_cart_variant`. */
const UNIQUE_CONSTRAINT_VIOLATION = 'P2002';

interface CartItemRow {
  readonly id: string;
  readonly cartId: string;
  readonly variantId: string;
  readonly quantity: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

const toDomain = (row: CartItemRow): CartItem =>
  CartItem.reconstitute({
    id: toCartItemId(row.id),
    cartId: toCartId(row.cartId),
    variantId: toProductVariantId(row.variantId),
    quantity: row.quantity,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });

/**
 * Maps rows to `CartItem` at the boundary; Prisma types never escape this
 * file (SDD 3.4). Plain `PrismaClient`, no RLS/tenant handling — `cart_items`
 * is outside `TENANT_SCOPED_MODELS`, same as `carts`. Every query filters
 * `deletedAt: null` (soft delete).
 */
export class PrismaCartItemRepository implements CartItemRepository {
  constructor(private readonly prisma: PrismaClient) {}

  withTransaction(scope: TransactionScope): CartItemRepository {
    return new PrismaCartItemRepository(scope as unknown as PrismaClient);
  }

  async create(item: CartItem): Promise<void> {
    try {
      await this.prisma.cartItem.create({
        data: {
          id: item.id,
          cartId: item.cartId,
          variantId: item.variantId,
          quantity: item.quantity,
          createdAt: item.createdAt,
          updatedAt: item.updatedAt,
        },
      });
    } catch (error) {
      // A concurrent add of the same variant to the same cart won
      // `uq_cart_items_cart_variant` first — the caller retries, the same
      // "database decides who wins" shape `PrismaAddressRepository.setDefault`
      // already establishes for its own partial unique index.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === UNIQUE_CONSTRAINT_VIOLATION
      ) {
        throw new CartWriteConflictError();
      }
      throw error;
    }
  }

  async findByCartAndVariant(
    cartId: CartId,
    variantId: ProductVariantId,
  ): Promise<CartItem | null> {
    const row = await this.prisma.cartItem.findFirst({
      where: { cartId, variantId, deletedAt: null },
    });
    return row ? toDomain(row) : null;
  }

  async findByCartAndId(id: CartItemId, cartId: CartId): Promise<CartItem | null> {
    const row = await this.prisma.cartItem.findFirst({
      where: { id, cartId, deletedAt: null },
    });
    return row ? toDomain(row) : null;
  }

  async listByCartId(cartId: CartId): Promise<readonly CartItem[]> {
    const rows = await this.prisma.cartItem.findMany({
      where: { cartId, deletedAt: null },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map(toDomain);
  }

  async updateQuantityIfOwned(item: CartItem, cartId: CartId): Promise<boolean> {
    const result = await this.prisma.cartItem.updateMany({
      where: { id: item.id, cartId, deletedAt: null },
      data: { quantity: item.quantity, updatedAt: item.updatedAt },
    });
    return result.count === 1;
  }

  async softDelete(id: CartItemId, cartId: CartId, now: Date): Promise<boolean> {
    const result = await this.prisma.cartItem.updateMany({
      where: { id, cartId, deletedAt: null },
      data: { deletedAt: now },
    });
    return result.count === 1;
  }

  async softDeleteAllForCart(cartId: CartId, now: Date): Promise<number> {
    const result = await this.prisma.cartItem.updateMany({
      where: { cartId, deletedAt: null },
      data: { deletedAt: now },
    });
    return result.count;
  }
}
