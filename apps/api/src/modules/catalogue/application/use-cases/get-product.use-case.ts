import type { Product } from '../../domain/entities/product.entity.js';
import { ProductNotFoundError } from '../../domain/errors/catalogue-errors.js';
import type { ProductRepository } from '../../domain/repositories/product.repository.js';
import type { ProductId } from '../../domain/value-objects/product-id.value-object.js';

export interface GetProductInput {
  readonly productId: ProductId;
}

export interface GetProductDeps {
  readonly productRepository: ProductRepository;
}

/**
 * One of the caller's own products.
 *
 * The repository is tenant-scoped, so another vendor's product id produces
 * the identical 404 a nonexistent one does — the caller cannot tell which,
 * and that non-disclosure is the point (SDD 6.6).
 *
 * A read: no transaction, no audit record (SDD 18.4 logs actions).
 */
export class GetProductUseCase {
  constructor(private readonly deps: GetProductDeps) {}

  async execute(input: GetProductInput): Promise<Product> {
    const product = await this.deps.productRepository.findById(input.productId);
    if (!product) {
      throw new ProductNotFoundError();
    }
    return product;
  }
}
