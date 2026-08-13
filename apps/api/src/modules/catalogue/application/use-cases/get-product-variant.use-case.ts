import type { ProductVariant } from '../../domain/entities/product-variant.entity.js';
import { ProductVariantNotFoundError } from '../../domain/errors/catalogue-errors.js';
import type { ProductVariantRepository } from '../../domain/repositories/product-variant.repository.js';
import type { ProductId } from '../../domain/value-objects/product-id.value-object.js';
import type { ProductVariantId } from '../../domain/value-objects/product-variant-id.value-object.js';

export interface GetProductVariantInput {
  readonly productId: ProductId;
  readonly variantId: ProductVariantId;
}

export interface GetProductVariantDeps {
  readonly productVariantRepository: ProductVariantRepository;
}

/**
 * One variant, scoped by both ids and by the caller's tenant.
 *
 * Three cases answer identically with a 404: the variant never existed, it
 * was deleted, and it belongs to another vendor — plus a fourth, that it is
 * this vendor's but hangs off a different product. None of them is
 * distinguishable to the caller, which is the whole point (SDD 6.6).
 *
 * A read: no transaction, no audit record.
 */
export class GetProductVariantUseCase {
  constructor(private readonly deps: GetProductVariantDeps) {}

  async execute(input: GetProductVariantInput): Promise<ProductVariant> {
    const variant = await this.deps.productVariantRepository.findByProductAndId(
      input.productId,
      input.variantId,
    );
    if (!variant) {
      throw new ProductVariantNotFoundError();
    }
    return variant;
  }
}
