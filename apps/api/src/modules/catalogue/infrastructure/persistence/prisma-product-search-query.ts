import { Prisma, type PrismaClient } from '@prisma/client';
import type { VendorId } from '../../../identity/index.js';
import type { ProductAttributeValues } from '../../domain/entities/product.entity.js';
import {
  toCategoryId,
  type CategoryId,
} from '../../domain/value-objects/category-id.value-object.js';
import { toProductId } from '../../domain/value-objects/product-id.value-object.js';
import type {
  ProductSearchCursor,
  ProductSearchPage,
  ProductSearchQueryPort,
  ProductSearchResultItem,
} from '../../application/ports/product-search-query.port.js';

interface SearchRow {
  id: string;
  category_id: string;
  name: string;
  brand: string | null;
  description: string | null;
  hsn_code: string | null;
  country_of_origin: string | null;
  net_quantity: string | null;
  attribute_values: unknown;
  media_count: bigint;
  created_at: Date;
  updated_at: Date;
}

const toResultItem = (row: SearchRow): ProductSearchResultItem => ({
  id: toProductId(row.id),
  categoryId: toCategoryId(row.category_id),
  name: row.name,
  brand: row.brand,
  description: row.description,
  hsnCode: row.hsn_code,
  countryOfOrigin: row.country_of_origin,
  netQuantity: row.net_quantity,
  attributeValues: (row.attribute_values ?? {}) as ProductAttributeValues,
  mediaCount: Number(row.media_count),
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

/**
 * Escapes ILIKE metacharacters in a user-supplied substring so a `%`/`_` the
 * caller typed is matched literally instead of acting as a wildcard. Not a
 * SQL-injection concern — every value below is a bound `Prisma.sql`
 * parameter, never concatenated into the query text — purely so a product
 * named "50%_off" stays findable by its literal name.
 */
const escapeLikePattern = (value: string): string => value.replace(/[\\%_]/g, (ch) => `\\${ch}`);

/** The `WHERE` clause's fragments, joined by the caller with `Prisma.join`. Split out so `search` itself stays a readable single query. */
const buildSearchConditions = (input: {
  readonly q?: string | undefined;
  readonly categoryId?: CategoryId | undefined;
  readonly vendorId?: VendorId | undefined;
  readonly cursor?: ProductSearchCursor | undefined;
}): Prisma.Sql[] => {
  const conditions: Prisma.Sql[] = [
    Prisma.sql`p.status = 'APPROVED'`,
    Prisma.sql`p.deleted_at IS NULL`,
  ];

  if (input.q) {
    // Full-text match on the generated `search_vector` (word-aware), OR'd
    // with a trigram-accelerated substring match on `name` — decision F:
    // pg_trgm here only broadens matching to partial words, never ranks.
    const likePattern = `%${escapeLikePattern(input.q)}%`;
    conditions.push(
      Prisma.sql`(p.search_vector @@ plainto_tsquery('simple', ${input.q}) OR p.name ILIKE ${likePattern} ESCAPE '\\')`,
    );
  }
  if (input.categoryId) {
    conditions.push(Prisma.sql`p.category_id = ${input.categoryId}::uuid`);
  }
  if (input.vendorId) {
    conditions.push(Prisma.sql`p.vendor_id = ${input.vendorId}::uuid`);
  }
  if (input.cursor) {
    // Keyset pagination on the same `(name ASC, id ASC)` total order the
    // query is sorted by (SDD 9.2) — a row-wise tuple comparison, so a
    // submission arriving mid-pagination cannot shift rows onto a page
    // already read the way an OFFSET would.
    conditions.push(Prisma.sql`(p.name, p.id) > (${input.cursor.name}, ${input.cursor.id}::uuid)`);
  }

  return conditions;
};

/**
 * The public, unauthenticated search path over `products` (S2-7, SDD 6.4/9.4).
 *
 * **Constructed on `publicPrisma`**, the `leenmart_public` credential — never
 * the tenant-scoped client, and never wrapped by `withTenantBoundary`: this
 * role's `products_public_read`/`product_media_public_read` policies are
 * static (`USING (status = ... AND deleted_at IS NULL)`), admitting the right
 * rows regardless of session state, so there is no tenant context for this
 * query to carry — the same reasoning `PrismaProductReviewQuery` gives for
 * `adminPrisma`. The `status`/`deleted_at` filters this class still writes
 * into its own SQL are belt-and-braces, not the actual enforcement.
 *
 * **Raw SQL, not the generated client**, for one concrete reason:
 * `search_vector` is deliberately absent from `schema.prisma` (no
 * `Unsupported("tsvector")` field — see the S2-7 migration's own comment), so
 * nothing about it is reachable through Prisma's typed `where`. Every
 * fragment below is composed with `Prisma.sql`/`Prisma.join`, which binds
 * each value as a parameter exactly the way a tagged-template `$queryRaw`
 * call does — never `$queryRawUnsafe`, and no caller-supplied value is ever
 * concatenated into the query text.
 */
export class PrismaProductSearchQuery implements ProductSearchQueryPort {
  constructor(private readonly publicPrisma: PrismaClient) {}

  async search(input: {
    readonly q?: string | undefined;
    readonly categoryId?: CategoryId | undefined;
    readonly vendorId?: VendorId | undefined;
    readonly limit: number;
    readonly cursor?: ProductSearchCursor | undefined;
  }): Promise<ProductSearchPage> {
    // One row beyond the page, so `hasMore` is an observation rather than a
    // second `count` query racing the first (mirrors `PrismaProductReviewQuery`).
    const take = input.limit + 1;
    const conditions = buildSearchConditions(input);

    const rows = await this.publicPrisma.$queryRaw<SearchRow[]>`
      SELECT
        p.id,
        p.category_id,
        p.name,
        p.brand,
        p.description,
        p.hsn_code,
        p.country_of_origin,
        p.net_quantity,
        p.attribute_values,
        p.created_at,
        p.updated_at,
        COALESCE(pm.media_count, 0) AS media_count
      FROM products p
      LEFT JOIN LATERAL (
        SELECT COUNT(*) AS media_count
        FROM product_media m
        WHERE m.product_id = p.id AND m.status = 'READY' AND m.deleted_at IS NULL
      ) pm ON true
      WHERE ${Prisma.join(conditions, ' AND ')}
      ORDER BY p.name ASC, p.id ASC
      LIMIT ${take}
    `;

    const hasMore = rows.length > input.limit;
    const page = hasMore ? rows.slice(0, input.limit) : rows;
    const last = page[page.length - 1];

    return {
      items: page.map(toResultItem),
      nextCursor: hasMore && last ? { name: last.name, id: last.id } : null,
      hasMore,
    };
  }
}
