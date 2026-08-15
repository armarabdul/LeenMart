import type { Product } from '../../domain/entities/product.entity.js';
import type { ProductVariant } from '../../domain/entities/product-variant.entity.js';
import { ProductNotFoundError } from '../../domain/errors/catalogue-errors.js';
import type { InventoryRepository } from '../../domain/repositories/inventory.repository.js';
import type { ProductMediaRepository } from '../../domain/repositories/product-media.repository.js';
import type { ProductRepository } from '../../domain/repositories/product.repository.js';
import type { ProductVariantRepository } from '../../domain/repositories/product-variant.repository.js';
import type { ProductId } from '../../domain/value-objects/product-id.value-object.js';

/** One variant plus the one inventory field a customer needs (S3-3 discovery milestone). */
export interface PublicProductVariantWithAvailability {
  readonly variant: ProductVariant;
  /** `Inventory.available` only — zero when no row exists, mirroring `AddCartItemUseCase`'s own "treat null as zero available" convention (S3-1). */
  readonly available: number;
}

export interface GetPublicProductDetailInput {
  readonly productId: ProductId;
}

export interface GetPublicProductDetailResult {
  readonly product: Product;
  /** Live `READY` media items only — the same signal `SearchProductsUseCase` publishes as `mediaCount`, no URLs. */
  readonly mediaCount: number;
  readonly variants: readonly PublicProductVariantWithAvailability[];
}

export interface GetPublicProductDetailDeps {
  readonly productRepository: ProductRepository;
  readonly productVariantRepository: ProductVariantRepository;
  readonly productMediaRepository: ProductMediaRepository;
  readonly inventoryRepository: InventoryRepository;
}

/**
 * One product as an anonymous customer sees it, with its variants and their
 * available stock (S3-3 discovery milestone, `GET /api/v1/catalogue/products/:id`).
 *
 * Every dependency here is the **exact same repository class** the vendor-
 * facing and cart surfaces already use, bound to `publicPrisma` instead of
 * the tenant-scoped client — the identical substitution S3-1's
 * `AddCartItemUseCase` already made for `ProductVariantRepository`/
 * `InventoryRepository`, and S2-7's `PrismaProductSearchQuery` made for
 * `ProductRepository`'s underlying table. `products_public_read` (S2-7) and
 * `product_variants_public_read`/`inventory_public_read` (S3-1) are what
 * confine every read here to APPROVED, non-deleted rows — this use case adds
 * no status check of its own, the same "RLS is the actual enforcement" design
 * `ProductRepository.findById`'s own comment already documents.
 *
 * An unknown, unapproved, or soft-deleted product id all produce the
 * identical `ProductNotFoundError` — `findById` returns `null` for all three
 * under this credential, and this method does not attempt to tell them apart.
 */
export class GetPublicProductDetailUseCase {
  constructor(private readonly deps: GetPublicProductDetailDeps) {}

  async execute(input: GetPublicProductDetailInput): Promise<GetPublicProductDetailResult> {
    const product = await this.deps.productRepository.findById(input.productId);
    if (!product) {
      throw new ProductNotFoundError();
    }

    const [variants, media] = await Promise.all([
      this.deps.productVariantRepository.listByProductId(input.productId),
      this.deps.productMediaRepository.listByProductId(input.productId),
    ]);

    const variantsWithAvailability = await Promise.all(
      variants.map(async (variant) => {
        const inventory = await this.deps.inventoryRepository.findByProductAndVariant(
          input.productId,
          variant.id,
        );
        return { variant, available: inventory?.available ?? 0 };
      }),
    );

    return {
      product,
      mediaCount: media.filter((item) => item.status === 'READY').length,
      variants: variantsWithAvailability,
    };
  }
}
