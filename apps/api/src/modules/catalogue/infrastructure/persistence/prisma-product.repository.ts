import type { Prisma, PrismaClient } from '@prisma/client';
import type { TransactionScope } from '@leen-mart/domain-kit';
import { toVendorId } from '../../../identity/index.js';
import { Product, type ProductAttributeValues } from '../../domain/entities/product.entity.js';
import type { ProductRepository } from '../../domain/repositories/product.repository.js';
import { toCategoryId } from '../../domain/value-objects/category-id.value-object.js';
import { toProductId, type ProductId } from '../../domain/value-objects/product-id.value-object.js';

interface ProductRow {
  readonly id: string;
  readonly vendorId: string;
  readonly categoryId: string;
  readonly name: string;
  readonly brand: string | null;
  readonly description: string | null;
  readonly hsnCode: string | null;
  readonly countryOfOrigin: string | null;
  readonly netQuantity: string | null;
  readonly attributeValues: Prisma.JsonValue;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly deletedAt: Date | null;
}

const toDomain = (row: ProductRow): Product =>
  Product.reconstitute({
    id: toProductId(row.id),
    vendorId: toVendorId(row.vendorId),
    categoryId: toCategoryId(row.categoryId),
    name: row.name,
    brand: row.brand,
    description: row.description,
    hsnCode: row.hsnCode,
    countryOfOrigin: row.countryOfOrigin,
    netQuantity: row.netQuantity,
    attributeValues: (row.attributeValues ?? {}) as ProductAttributeValues,
    status: 'DRAFT',
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    deletedAt: row.deletedAt,
  });

/**
 * Maps rows to `Product` at the boundary; Prisma types never escape this file
 * (SDD 3.4). Every read filters `deletedAt: null`.
 *
 * Runs on the tenant-scoped `prisma` client (S2-3a): `Product` is in
 * `TENANT_SCOPED_MODELS`, so every query here requires an ambient tenant
 * context (`tenantContext` middleware in production, `runWithTenant` in
 * tests) or throws `MissingTenantContextError` before reaching PostgreSQL.
 * RLS enforces the same boundary again beneath it.
 */
export class PrismaProductRepository implements ProductRepository {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Rebinds to a caller's transaction. The cast is confined to this layer:
   * the port cannot name `PrismaClient` (SDD 2.3), and only
   * `TransactionRunner.run` can produce a `TransactionScope`.
   *
   * No `inCallerTransaction` flag, unlike `PrismaCategoryRepository`: both
   * methods here are single statements, so neither opens a transaction of its
   * own or needs to know whether it already sits in one — the same reasoning
   * `PrismaCategoryAttributeRepository` gives.
   */
  withTransaction(scope: TransactionScope): ProductRepository {
    return new PrismaProductRepository(scope as unknown as PrismaClient);
  }

  async create(product: Product): Promise<void> {
    await this.prisma.product.create({
      data: {
        id: product.id,
        vendorId: product.vendorId,
        categoryId: product.categoryId,
        name: product.name,
        brand: product.brand,
        description: product.description,
        hsnCode: product.hsnCode,
        countryOfOrigin: product.countryOfOrigin,
        netQuantity: product.netQuantity,
        attributeValues: product.attributeValues as Prisma.InputJsonValue,
        createdAt: product.createdAt,
        updatedAt: product.updatedAt,
      },
    });
  }

  async findById(id: ProductId): Promise<Product | null> {
    const row = await this.prisma.product.findFirst({ where: { id, deletedAt: null } });
    return row ? toDomain(row) : null;
  }
}
