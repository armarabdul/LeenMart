import type { ProductVariant } from '../../domain/entities/product-variant.entity.js';
import { ProductNotFoundError } from '../../domain/errors/catalogue-errors.js';
import type { ProductRepository } from '../../domain/repositories/product.repository.js';
import type { ProductVariantRepository } from '../../domain/repositories/product-variant.repository.js';
import type { ProductId } from '../../domain/value-objects/product-id.value-object.js';

export interface ListProductVariantsInput {
  readonly productId: ProductId;
}

export interface ListProductVariantsDeps {
  readonly productRepository: ProductRepository;
  readonly productVariantRepository: ProductVariantRepository;
}

/**
 * Every live variant of one of the caller's own products, oldest first.
 *
 * **Not paginated**, unlike the product list: a product's variant set is small
 * and only useful whole — the same reasoning `ListCategoryAttributesUseCase`
 * records for attributes.
 *
 * The product is checked first so an unknown — or another vendor's — id
 * answers 404 rather than an empty array, which would be indistinguishable
 * from a product that genuinely has no variants and would also confirm
 * nothing about whether the id exists.
 *
 * A read: no transaction, no audit record.
 */
export class ListProductVariantsUseCase {
  constructor(private readonly deps: ListProductVariantsDeps) {}

  async execute(input: ListProductVariantsInput): Promise<readonly ProductVariant[]> {
    const product = await this.deps.productRepository.findById(input.productId);
    if (!product) {
      throw new ProductNotFoundError();
    }
    return this.deps.productVariantRepository.listByProductId(input.productId);
  }
}
