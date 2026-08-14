import type { Prisma, PrismaClient } from '@prisma/client';
import type { TransactionScope } from '@leen-mart/domain-kit';
import { toVendorId } from '../../../identity/index.js';
import {
  Product,
  type ProductAttributeValues,
  type ProductStatusName,
} from '../../domain/entities/product.entity.js';
import type {
  ProductPage,
  ProductRepository,
} from '../../domain/repositories/product.repository.js';
import { toCategoryId } from '../../domain/value-objects/category-id.value-object.js';
import { toProductId, type ProductId } from '../../domain/value-objects/product-id.value-object.js';
import { ProductRejectionReason } from '../../domain/value-objects/product-rejection-reason.value-object.js';

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
  readonly status: string;
  readonly rejectionReason: string | null;
  readonly rejectionNote: string | null;
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
    status: row.status as ProductStatusName,
    rejectionReason: row.rejectionReason
      ? ProductRejectionReason.fromName(row.rejectionReason)
      : null,
    rejectionNote: row.rejectionNote,
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

  async update(product: Product): Promise<boolean> {
    const result = await this.prisma.product.updateMany({
      where: { id: product.id, deletedAt: null },
      data: {
        categoryId: product.categoryId,
        name: product.name,
        brand: product.brand,
        description: product.description,
        hsnCode: product.hsnCode,
        countryOfOrigin: product.countryOfOrigin,
        netQuantity: product.netQuantity,
        attributeValues: product.attributeValues as Prisma.InputJsonValue,
        updatedAt: product.updatedAt,
      },
    });
    return result.count === 1;
  }

  async listPage(input: { limit: number; cursor?: string | undefined }): Promise<ProductPage> {
    // One row beyond the page, so `hasMore` is an observation rather than a
    // second count query — the same shape `PrismaCategoryRepository.listPage`
    // uses.
    const take = input.limit + 1;
    const rows = await this.prisma.product.findMany({
      where: { deletedAt: null },
      // UUID v7 is time-ordered, so `id` alone is a total order and the keyset
      // cursor below can neither skip nor repeat a row.
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

  async softDelete(product: Product): Promise<boolean> {
    const result = await this.prisma.product.updateMany({
      where: { id: product.id, deletedAt: null },
      data: { deletedAt: product.deletedAt, updatedAt: product.updatedAt },
    });
    return result.count === 1;
  }

  /**
   * An `UPDATE` of the product's own `updated_at` — which is what takes the
   * exclusive row lock PostgreSQL holds until the caller's transaction ends.
   *
   * A plain `SELECT ... FOR UPDATE` would be the textbook form, but Prisma's
   * query API cannot express it and reaching for raw SQL here would step
   * outside the tenant extension for a rule the extension is what enforces.
   * An `UPDATE` takes the same lock through the sanctioned path, and touching
   * `updated_at` is honest besides: the product's variant set is changing.
   */
  async lockForVariantChange(id: ProductId, now: Date): Promise<boolean> {
    const result = await this.prisma.product.updateMany({
      where: { id, deletedAt: null },
      data: { updatedAt: now },
    });
    return result.count === 1;
  }

  /**
   * The conditional `WHERE status IN ('DRAFT', 'REJECTED')` is the whole
   * arbitration — never a read-then-write. Two concurrent submissions may
   * both have loaded an eligible row; only the first `UPDATE` to reach
   * PostgreSQL affects it, and the second's `updateMany` reports zero rows.
   */
  async submitForReviewIfEligible(product: Product): Promise<boolean> {
    const result = await this.prisma.product.updateMany({
      where: {
        id: product.id,
        deletedAt: null,
        status: { in: ['DRAFT', 'REJECTED'] },
      },
      data: {
        status: product.status,
        rejectionReason: product.rejectionReason?.name ?? null,
        rejectionNote: product.rejectionNote,
        updatedAt: product.updatedAt,
      },
    });
    return result.count === 1;
  }

  /**
   * The conditional `WHERE status = 'PENDING_REVIEW'` is the arbitration for
   * concurrent approve/reject decisions, the same "database decides who wins"
   * pattern `submitForReviewIfEligible` uses one transition earlier.
   */
  async decideIfPendingReview(product: Product): Promise<boolean> {
    const result = await this.prisma.product.updateMany({
      where: { id: product.id, deletedAt: null, status: 'PENDING_REVIEW' },
      data: {
        status: product.status,
        rejectionReason: product.rejectionReason?.name ?? null,
        rejectionNote: product.rejectionNote,
        updatedAt: product.updatedAt,
      },
    });
    return result.count === 1;
  }

  /** Same mechanism as `lockForVariantChange` — an `UPDATE` of `updated_at`, which is what takes the lock. */
  async lockForMediaChange(id: ProductId, now: Date): Promise<boolean> {
    const result = await this.prisma.product.updateMany({
      where: { id, deletedAt: null },
      data: { updatedAt: now },
    });
    return result.count === 1;
  }

  async reenterReviewIfApproved(product: Product): Promise<boolean> {
    const result = await this.prisma.product.updateMany({
      where: { id: product.id, deletedAt: null, status: 'APPROVED' },
      data: { status: product.status, updatedAt: product.updatedAt },
    });
    return result.count === 1;
  }
}
