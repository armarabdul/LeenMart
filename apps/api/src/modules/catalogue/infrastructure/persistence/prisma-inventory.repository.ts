import type { PrismaClient } from '@prisma/client';
import type { TransactionScope } from '@leen-mart/domain-kit';
import { toVendorId } from '../../../identity/index.js';
import { Inventory } from '../../domain/entities/inventory.entity.js';
import type { InventoryRepository } from '../../domain/repositories/inventory.repository.js';
import type { ProductId } from '../../domain/value-objects/product-id.value-object.js';
import {
  toProductVariantId,
  type ProductVariantId,
} from '../../domain/value-objects/product-variant-id.value-object.js';

interface InventoryRow {
  readonly variantId: string;
  readonly vendorId: string;
  readonly available: number;
  readonly reserved: number;
  readonly version: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

const toDomain = (row: InventoryRow): Inventory =>
  Inventory.reconstitute({
    variantId: toProductVariantId(row.variantId),
    vendorId: toVendorId(row.vendorId),
    available: row.available,
    reserved: row.reserved,
    version: row.version,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });

/**
 * Maps rows to `Inventory` at the boundary; Prisma types never escape this
 * file (SDD 3.4).
 *
 * Runs on the tenant-scoped `prisma` client: `Inventory` is in
 * `TENANT_SCOPED_MODELS`, so every query here requires an ambient tenant
 * context or throws before reaching PostgreSQL, and the RLS policies enforce
 * the same boundary again beneath it.
 *
 * No `deletedAt` filter anywhere, unlike every other repository in this
 * module: inventory has no soft-delete column. A counter belongs to its
 * variant and is removed with it.
 */
export class PrismaInventoryRepository implements InventoryRepository {
  constructor(private readonly prisma: PrismaClient) {}

  /** No `inCallerTransaction` flag — every method here is a single statement. */
  withTransaction(scope: TransactionScope): InventoryRepository {
    return new PrismaInventoryRepository(scope as unknown as PrismaClient);
  }

  async create(inventory: Inventory): Promise<void> {
    await this.prisma.inventory.create({
      data: {
        variantId: inventory.variantId,
        vendorId: inventory.vendorId,
        available: inventory.available,
        reserved: inventory.reserved,
        version: inventory.version,
        createdAt: inventory.createdAt,
        updatedAt: inventory.updatedAt,
      },
    });
  }

  async findByProductAndVariant(
    productId: ProductId,
    variantId: ProductVariantId,
  ): Promise<Inventory | null> {
    // Joined through the variant rather than trusting the variant id alone, so
    // a real variant addressed under the wrong product reads as absent.
    const row = await this.prisma.inventory.findFirst({
      where: { variantId, variant: { productId, deletedAt: null } },
    });
    return row ? toDomain(row) : null;
  }

  async setIfVersionMatches(inventory: Inventory, expectedVersion: number): Promise<boolean> {
    // The version lives in the `WHERE`, never in a prior read: a caller that
    // checked first would still lose to a write landing in between.
    const result = await this.prisma.inventory.updateMany({
      where: { variantId: inventory.variantId, version: expectedVersion },
      data: {
        available: inventory.available,
        version: inventory.version,
        updatedAt: inventory.updatedAt,
      },
    });
    return result.count === 1;
  }

  async deleteForVariants(variantIds: readonly ProductVariantId[]): Promise<number> {
    if (variantIds.length === 0) {
      return 0;
    }
    const result = await this.prisma.inventory.deleteMany({
      where: { variantId: { in: [...variantIds] } },
    });
    return result.count;
  }

  async deleteForProduct(productId: ProductId): Promise<number> {
    const result = await this.prisma.inventory.deleteMany({ where: { variant: { productId } } });
    return result.count;
  }
}
