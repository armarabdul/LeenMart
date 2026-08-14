import type { ProductMedia } from '../../domain/entities/product-media.entity.js';
import { ProductNotFoundError } from '../../domain/errors/catalogue-errors.js';
import type { ProductRepository } from '../../domain/repositories/product.repository.js';
import type { ProductMediaRepository } from '../../domain/repositories/product-media.repository.js';
import type { ProductId } from '../../domain/value-objects/product-id.value-object.js';

export interface ListProductMediaInput {
  readonly productId: ProductId;
}

export interface ListProductMediaDeps {
  readonly productRepository: ProductRepository;
  readonly productMediaRepository: ProductMediaRepository;
}

/**
 * Every live media item of one of the caller's own products, oldest first.
 *
 * The product is checked first so an unknown — or another vendor's — id
 * answers 404 rather than an empty array, the same reasoning
 * `ListProductVariantsUseCase` records.
 *
 * A read: no transaction, no audit record.
 */
export class ListProductMediaUseCase {
  constructor(private readonly deps: ListProductMediaDeps) {}

  async execute(input: ListProductMediaInput): Promise<readonly ProductMedia[]> {
    const product = await this.deps.productRepository.findById(input.productId);
    if (!product) {
      throw new ProductNotFoundError();
    }
    return this.deps.productMediaRepository.listByProductId(input.productId);
  }
}
