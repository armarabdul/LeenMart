import type { Prisma, PrismaClient } from '@prisma/client';
import { toVendorId } from '../../../identity/index.js';
import type { ProductAttributeValues } from '../../domain/entities/product.entity.js';
import { toCategoryId } from '../../domain/value-objects/category-id.value-object.js';
import { toProductId, type ProductId } from '../../domain/value-objects/product-id.value-object.js';
import type {
  ProductReviewDetail,
  ProductReviewQueryPort,
  ProductReviewQueuePage,
  ProductReviewStatus,
} from '../../application/ports/product-review-query.port.js';

/**
 * The columns this query is allowed to read.
 *
 * Written as an explicit `select` rather than fetching the row, the same
 * discipline `PrismaKycReviewQuery`'s `QUEUE_SELECT` uses — naming what comes
 * back means a column added to `products` later cannot be published here by
 * accident.
 */
const QUEUE_SELECT = {
  id: true,
  vendorId: true,
  categoryId: true,
  name: true,
  status: true,
  updatedAt: true,
} as const;

const DETAIL_SELECT = {
  ...QUEUE_SELECT,
  brand: true,
  description: true,
  hsnCode: true,
  countryOfOrigin: true,
  netQuantity: true,
  attributeValues: true,
  rejectionReason: true,
  rejectionNote: true,
  createdAt: true,
} as const;

type QueueRow = Prisma.ProductGetPayload<{ select: typeof QUEUE_SELECT }>;
type DetailRow = Prisma.ProductGetPayload<{ select: typeof DETAIL_SELECT }>;

const toQueueItem = (row: QueueRow): ProductReviewQueuePage['items'][number] => ({
  productId: toProductId(row.id),
  vendorId: toVendorId(row.vendorId),
  categoryId: toCategoryId(row.categoryId),
  name: row.name,
  status: row.status as ProductReviewStatus,
  updatedAt: row.updatedAt,
});

const toDetail = (row: DetailRow): ProductReviewDetail => ({
  ...toQueueItem(row),
  brand: row.brand,
  description: row.description,
  hsnCode: row.hsnCode,
  countryOfOrigin: row.countryOfOrigin,
  netQuantity: row.netQuantity,
  attributeValues: (row.attributeValues ?? {}) as ProductAttributeValues,
  rejectionReason: row.rejectionReason,
  rejectionNote: row.rejectionNote,
  createdAt: row.createdAt,
});

/**
 * The administrator's cross-tenant read path for product moderation (S2-5),
 * on the `leenmart_admin` credential — mirrors `PrismaKycReviewQuery` exactly.
 *
 * **Constructed with `adminPrisma`, never the tenant-scoped client.** The
 * vendor-facing client's RLS policies compare `vendor_id` to `app.vendor_id`,
 * so a queue query through it would return one vendor's rows or, with no
 * tenant context, none at all. `products_admin_read`'s `USING (true)` is what
 * lets this client see every vendor.
 *
 * No tenant boundary extension either — `adminPrisma` is never wrapped by
 * `withTenantBoundary` (`Product` being in `TENANT_SCOPED_MODELS` governs the
 * ordinary client, not this one), so these queries need no `app.vendor_id`
 * and open no transaction. Reads only — the port has no write method.
 */
export class PrismaProductReviewQuery implements ProductReviewQueryPort {
  constructor(private readonly adminPrisma: PrismaClient) {}

  async listForReview(input: {
    statuses: readonly ProductReviewStatus[];
    limit: number;
    cursor?: string | undefined;
  }): Promise<ProductReviewQueuePage> {
    // One row beyond the page, so `hasMore` is an observation rather than a
    // second `count` query racing the first.
    const take = input.limit + 1;

    const rows = await this.adminPrisma.product.findMany({
      where: { status: { in: [...input.statuses] }, deletedAt: null },
      select: QUEUE_SELECT,
      // Oldest first: a queue surfacing the newest submission first would
      // starve whoever has waited longest. `id` breaks ties so the order is
      // total and the keyset cursor below cannot skip or repeat a row.
      orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }],
      take,
      ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
    });

    const hasMore = rows.length > input.limit;
    const page = hasMore ? rows.slice(0, input.limit) : rows;

    return {
      items: page.map(toQueueItem),
      nextCursor: hasMore ? (page[page.length - 1]?.id ?? null) : null,
      hasMore,
    };
  }

  async findDetailById(productId: ProductId): Promise<ProductReviewDetail | null> {
    const row = await this.adminPrisma.product.findFirst({
      where: { id: productId, deletedAt: null },
      select: DETAIL_SELECT,
    });
    return row ? toDetail(row) : null;
  }
}
