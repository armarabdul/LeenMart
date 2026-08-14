import type { TransactionScope } from '@leen-mart/domain-kit';
import type { PrismaClient } from '@prisma/client';
import { toVendorId } from '../../../identity/index.js';
import {
  ProductMediaVariant,
  type ProductMediaVariantFormat,
  type ProductMediaVariantWidth,
} from '../../domain/entities/product-media-variant.entity.js';
import type { ProductMediaVariantRepository } from '../../domain/repositories/product-media-variant.repository.js';
import {
  toProductMediaId,
  type ProductMediaId,
} from '../../domain/value-objects/product-media-id.value-object.js';
import { toProductMediaVariantId } from '../../domain/value-objects/product-media-variant-id.value-object.js';

interface ProductMediaVariantRow {
  readonly id: string;
  readonly mediaId: string;
  readonly vendorId: string;
  readonly width: number;
  readonly format: string;
  readonly objectKey: string;
  readonly sizeBytes: number;
  readonly createdAt: Date;
}

const toDomain = (row: ProductMediaVariantRow): ProductMediaVariant =>
  ProductMediaVariant.reconstitute({
    id: toProductMediaVariantId(row.id),
    mediaId: toProductMediaId(row.mediaId),
    vendorId: toVendorId(row.vendorId),
    width: row.width as ProductMediaVariantWidth,
    format: row.format as ProductMediaVariantFormat,
    objectKey: row.objectKey,
    sizeBytes: row.sizeBytes,
    createdAt: row.createdAt,
  });

/**
 * Maps rows to `ProductMediaVariant` at the boundary; Prisma types never
 * escape this file (SDD 3.4).
 *
 * Runs on the tenant-scoped `prisma` client (S2-6b): `ProductMediaVariant` is
 * in `TENANT_SCOPED_MODELS`, so every query here requires an ambient tenant
 * context or throws `MissingTenantContextError` before reaching PostgreSQL.
 * RLS enforces the same boundary again beneath it.
 */
export class PrismaProductMediaVariantRepository implements ProductMediaVariantRepository {
  constructor(private readonly prisma: PrismaClient) {}

  /** No `inCallerTransaction` flag — see `PrismaProductRepository.withTransaction`. */
  withTransaction(scope: TransactionScope): ProductMediaVariantRepository {
    return new PrismaProductMediaVariantRepository(scope as unknown as PrismaClient);
  }

  /**
   * `createMany` with `skipDuplicates: true` compiles to `INSERT ... ON
   * CONFLICT DO NOTHING` against `uq_product_media_variants_media_width_format`
   * — the database is the arbiter, never a prior `findFirst`. `count` is 0
   * when the row was already there, 1 when this call just wrote it; either
   * way the row exists once this resolves.
   */
  async createIfAbsent(variant: ProductMediaVariant): Promise<boolean> {
    const result = await this.prisma.productMediaVariant.createMany({
      data: [
        {
          id: variant.id,
          mediaId: variant.mediaId,
          vendorId: variant.vendorId,
          width: variant.width,
          format: variant.format,
          objectKey: variant.objectKey,
          sizeBytes: variant.sizeBytes,
          createdAt: variant.createdAt,
        },
      ],
      skipDuplicates: true,
    });
    return result.count === 1;
  }

  async listByMediaId(mediaId: ProductMediaId): Promise<readonly ProductMediaVariant[]> {
    const rows = await this.prisma.productMediaVariant.findMany({
      where: { mediaId },
      orderBy: [{ width: 'asc' }, { format: 'asc' }],
    });
    return rows.map(toDomain);
  }

  async countByMediaId(mediaId: ProductMediaId): Promise<number> {
    return this.prisma.productMediaVariant.count({ where: { mediaId } });
  }
}
