import { Money, type TransactionScope } from '@leen-mart/domain-kit';
import { Prisma, type PrismaClient } from '@prisma/client';
import { toVendorId } from '../../../identity/index.js';
import { ProductVariant } from '../../domain/entities/product-variant.entity.js';
import { ProductVariantSkuConflictError } from '../../domain/errors/catalogue-errors.js';
import type { ProductVariantRepository } from '../../domain/repositories/product-variant.repository.js';
import { toProductId } from '../../domain/value-objects/product-id.value-object.js';
import {
  toProductVariantId,
  type ProductVariantId,
} from '../../domain/value-objects/product-variant-id.value-object.js';
import { toSku } from '../../domain/value-objects/sku.value-object.js';

/** Prisma's unique-constraint-violation code, same as `PrismaCategoryRepository`. */
const UNIQUE_CONSTRAINT_VIOLATION = 'P2002';

interface ProductVariantRow {
  readonly id: string;
  readonly productId: string;
  readonly vendorId: string;
  readonly sku: string;
  readonly name: string;
  readonly priceAmount: bigint;
  readonly priceCurrency: string;
  readonly unitOfMeasure: string;
  readonly quantityStep: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly deletedAt: Date | null;
}

const toDomain = (row: ProductVariantRow): ProductVariant =>
  ProductVariant.reconstitute({
    id: toProductVariantId(row.id),
    productId: toProductId(row.productId),
    vendorId: toVendorId(row.vendorId),
    sku: toSku(row.sku),
    name: row.name,
    price: Money.fromMinor(row.priceAmount, 'INR'),
    unitOfMeasure: row.unitOfMeasure,
    quantityStep: row.quantityStep,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    deletedAt: row.deletedAt,
  });

/**
 * Translates the `(vendor_id, sku)` unique-index violation into the error
 * that names the rule actually broken. Mirrors
 * `PrismaCategoryRepository`'s `translateUniqueViolation`.
 */
const translateUniqueViolation = (error: unknown): never => {
  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === UNIQUE_CONSTRAINT_VIOLATION
  ) {
    throw new ProductVariantSkuConflictError();
  }
  throw error;
};

/**
 * Maps rows to `ProductVariant` at the boundary; Prisma types never escape
 * this file (SDD 3.4). Every read filters `deletedAt: null`.
 *
 * Runs on the tenant-scoped `prisma` client, same as `PrismaProductRepository`
 * — `ProductVariant` is in `TENANT_SCOPED_MODELS` too.
 */
export class PrismaProductVariantRepository implements ProductVariantRepository {
  constructor(private readonly prisma: PrismaClient) {}

  /** No `inCallerTransaction` flag — see `PrismaProductRepository.withTransaction`. */
  withTransaction(scope: TransactionScope): ProductVariantRepository {
    return new PrismaProductVariantRepository(scope as unknown as PrismaClient);
  }

  async create(variant: ProductVariant): Promise<void> {
    try {
      await this.prisma.productVariant.create({
        data: {
          id: variant.id,
          productId: variant.productId,
          vendorId: variant.vendorId,
          sku: variant.sku,
          name: variant.name,
          priceAmount: variant.price.amountMinor,
          priceCurrency: variant.price.currency,
          unitOfMeasure: variant.unitOfMeasure,
          quantityStep: variant.quantityStep,
          createdAt: variant.createdAt,
          updatedAt: variant.updatedAt,
        },
      });
    } catch (error) {
      translateUniqueViolation(error);
    }
  }

  async findById(id: ProductVariantId): Promise<ProductVariant | null> {
    const row = await this.prisma.productVariant.findFirst({ where: { id, deletedAt: null } });
    return row ? toDomain(row) : null;
  }
}
