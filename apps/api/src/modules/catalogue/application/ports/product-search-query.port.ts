import type { VendorId } from '../../../identity/index.js';
import type { ProductAttributeValues } from '../../domain/entities/product.entity.js';
import type { CategoryId } from '../../domain/value-objects/category-id.value-object.js';
import type { ProductId } from '../../domain/value-objects/product-id.value-object.js';

/** One product as an anonymous searcher may see it — see `publicProductSearchResultSchema`'s own comment for what is deliberately absent and why. */
export interface ProductSearchResultItem {
  readonly id: ProductId;
  readonly categoryId: CategoryId;
  readonly name: string;
  readonly brand: string | null;
  readonly description: string | null;
  readonly hsnCode: string | null;
  readonly countryOfOrigin: string | null;
  readonly netQuantity: string | null;
  readonly attributeValues: ProductAttributeValues;
  readonly mediaCount: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/**
 * A keyset position in the `(name ASC, id ASC)` ordering (SDD 9.2).
 *
 * Structured here, opaque on the wire — `SearchProductsUseCase` is the only
 * place that knows this shape is base64url JSON; the port and its Prisma
 * adapter only ever see a decoded `{ name, id }` pair.
 */
export interface ProductSearchCursor {
  readonly name: string;
  readonly id: string;
}

export interface ProductSearchPage {
  readonly items: readonly ProductSearchResultItem[];
  readonly nextCursor: ProductSearchCursor | null;
  readonly hasMore: boolean;
}

/**
 * The public, unauthenticated read path over `products` (S2-7, SDD 6.4/9.4).
 *
 * A separate port from `ProductRepository` for the same reason
 * `ProductReviewQueryPort` is: this answers to a different authority (no
 * authority at all, in fact — an anonymous caller) and runs on its own
 * credential, `leenmart_public`, whose RLS policy structurally admits only
 * `APPROVED`, non-deleted rows. The `status`/`deletedAt` filters this port's
 * Prisma adapter still writes into its own queries are belt-and-braces, not
 * the actual enforcement — the same defence-in-depth `PrismaProductReviewQuery`
 * practises even though `products_admin_read` already governs its client.
 */
export interface ProductSearchQueryPort {
  search(input: {
    readonly q?: string | undefined;
    readonly categoryId?: CategoryId | undefined;
    readonly vendorId?: VendorId | undefined;
    readonly limit: number;
    readonly cursor?: ProductSearchCursor | undefined;
  }): Promise<ProductSearchPage>;
}
