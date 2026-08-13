import type {
  ProductPage,
  ProductRepository,
} from '../../domain/repositories/product.repository.js';

export interface ListProductsInput {
  readonly limit: number;
  readonly cursor?: string | undefined;
}

export interface ListProductsDeps {
  readonly productRepository: ProductRepository;
}

/**
 * One page of the caller's own products, on the platform's existing cursor
 * convention (SDD 9.2) rather than a shape invented here.
 *
 * No `vendorId` parameter: the repository runs on the tenant-scoped client, so
 * the page contains this vendor's products because it *cannot* contain
 * anyone else's — not because a filter was remembered.
 *
 * A read: no transaction, no audit record.
 */
export class ListProductsUseCase {
  constructor(private readonly deps: ListProductsDeps) {}

  execute(input: ListProductsInput): Promise<ProductPage> {
    return this.deps.productRepository.listPage({ limit: input.limit, cursor: input.cursor });
  }
}
