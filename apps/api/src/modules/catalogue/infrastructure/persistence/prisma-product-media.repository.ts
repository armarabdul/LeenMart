import type { TransactionScope } from '@leen-mart/domain-kit';
import type { PrismaClient } from '@prisma/client';
import { toVendorId } from '../../../identity/index.js';
import {
  ProductMedia,
  type ProductMediaStatusName,
} from '../../domain/entities/product-media.entity.js';
import type { ProductMediaRepository } from '../../domain/repositories/product-media.repository.js';
import { toProductId, type ProductId } from '../../domain/value-objects/product-id.value-object.js';
import {
  toProductMediaId,
  type ProductMediaId,
} from '../../domain/value-objects/product-media-id.value-object.js';

interface ProductMediaRow {
  readonly id: string;
  readonly productId: string;
  readonly vendorId: string;
  readonly objectKey: string;
  readonly contentType: string;
  readonly sizeBytes: number;
  readonly status: string;
  readonly failureReason: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly deletedAt: Date | null;
}

const toDomain = (row: ProductMediaRow): ProductMedia =>
  ProductMedia.reconstitute({
    id: toProductMediaId(row.id),
    productId: toProductId(row.productId),
    vendorId: toVendorId(row.vendorId),
    objectKey: row.objectKey,
    contentType: row.contentType,
    sizeBytes: row.sizeBytes,
    status: row.status as ProductMediaStatusName,
    failureReason: row.failureReason,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    deletedAt: row.deletedAt,
  });

/**
 * Maps rows to `ProductMedia` at the boundary; Prisma types never escape this
 * file (SDD 3.4). Every read filters `deletedAt: null`.
 *
 * Runs on the tenant-scoped `prisma` client (S2-6a): `ProductMedia` is in
 * `TENANT_SCOPED_MODELS`, so every query here requires an ambient tenant
 * context or throws `MissingTenantContextError` before reaching PostgreSQL.
 * RLS enforces the same boundary again beneath it.
 */
export class PrismaProductMediaRepository implements ProductMediaRepository {
  constructor(private readonly prisma: PrismaClient) {}

  /** No `inCallerTransaction` flag — see `PrismaProductRepository.withTransaction`. */
  withTransaction(scope: TransactionScope): ProductMediaRepository {
    return new PrismaProductMediaRepository(scope as unknown as PrismaClient);
  }

  async create(media: ProductMedia): Promise<void> {
    await this.prisma.productMedia.create({
      data: {
        id: media.id,
        productId: media.productId,
        vendorId: media.vendorId,
        objectKey: media.objectKey,
        contentType: media.contentType,
        sizeBytes: media.sizeBytes,
        status: media.status,
        createdAt: media.createdAt,
        updatedAt: media.updatedAt,
      },
    });
  }

  async findById(id: ProductMediaId): Promise<ProductMedia | null> {
    const row = await this.prisma.productMedia.findFirst({ where: { id, deletedAt: null } });
    return row ? toDomain(row) : null;
  }

  async findByProductAndId(productId: ProductId, id: ProductMediaId): Promise<ProductMedia | null> {
    const row = await this.prisma.productMedia.findFirst({
      where: { id, productId, deletedAt: null },
    });
    return row ? toDomain(row) : null;
  }

  async listByProductId(productId: ProductId): Promise<readonly ProductMedia[]> {
    const rows = await this.prisma.productMedia.findMany({
      where: { productId, deletedAt: null },
      // UUID v7 is time-ordered, so this is creation order without a second
      // column — oldest first, the same convention `listByProductId` on
      // `ProductVariantRepository` uses.
      orderBy: { id: 'asc' },
    });
    return rows.map(toDomain);
  }

  async countLiveForProduct(productId: ProductId): Promise<number> {
    return this.prisma.productMedia.count({ where: { productId, deletedAt: null } });
  }

  /**
   * The conditional `WHERE status = 'AWAITING_UPLOAD'` is the whole
   * arbitration — never a read-then-write. Two concurrent completions may
   * both have loaded the same eligible row; only the first `UPDATE` to reach
   * PostgreSQL affects it, and the second's `updateMany` reports zero rows.
   */
  async completeIfAwaitingUpload(media: ProductMedia): Promise<boolean> {
    const result = await this.prisma.productMedia.updateMany({
      where: { id: media.id, deletedAt: null, status: 'AWAITING_UPLOAD' },
      data: { status: media.status, updatedAt: media.updatedAt },
    });
    return result.count === 1;
  }

  /** The conditional `WHERE status = 'PROCESSING'` is the whole arbitration — see the port's own doc comment. */
  async markReadyIfProcessing(media: ProductMedia): Promise<boolean> {
    const result = await this.prisma.productMedia.updateMany({
      where: { id: media.id, deletedAt: null, status: 'PROCESSING' },
      data: {
        status: media.status,
        failureReason: media.failureReason,
        updatedAt: media.updatedAt,
      },
    });
    return result.count === 1;
  }

  async markFailedIfProcessing(media: ProductMedia): Promise<boolean> {
    const result = await this.prisma.productMedia.updateMany({
      where: { id: media.id, deletedAt: null, status: 'PROCESSING' },
      data: {
        status: media.status,
        failureReason: media.failureReason,
        updatedAt: media.updatedAt,
      },
    });
    return result.count === 1;
  }

  async markProcessingIfFailed(media: ProductMedia): Promise<boolean> {
    const result = await this.prisma.productMedia.updateMany({
      where: { id: media.id, deletedAt: null, status: 'FAILED' },
      data: {
        status: media.status,
        failureReason: media.failureReason,
        updatedAt: media.updatedAt,
      },
    });
    return result.count === 1;
  }

  async softDelete(media: ProductMedia): Promise<boolean> {
    const result = await this.prisma.productMedia.updateMany({
      where: { id: media.id, productId: media.productId, deletedAt: null },
      data: { deletedAt: media.deletedAt, updatedAt: media.updatedAt },
    });
    return result.count === 1;
  }
}
