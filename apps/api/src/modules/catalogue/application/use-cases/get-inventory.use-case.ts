import type { Inventory } from '../../domain/entities/inventory.entity.js';
import { InventoryNotFoundError } from '../../domain/errors/catalogue-errors.js';
import type { InventoryRepository } from '../../domain/repositories/inventory.repository.js';
import type { ProductId } from '../../domain/value-objects/product-id.value-object.js';
import type { ProductVariantId } from '../../domain/value-objects/product-variant-id.value-object.js';

export interface GetInventoryInput {
  readonly productId: ProductId;
  readonly variantId: ProductVariantId;
}

export interface GetInventoryDeps {
  readonly inventoryRepository: InventoryRepository;
}

/**
 * The stock level of one of the caller's own variants.
 *
 * The response carries `version`, and that is not incidental: it is what the
 * vendor sends back on the next `PATCH`, and the only thing that makes the
 * optimistic guard work.
 *
 * Scoped by both ids and by the tenant, so a variant belonging to another
 * vendor — or to a different product — reads as absent, identically to one
 * that never existed.
 *
 * A read: no transaction, no audit record (SDD 18.4 logs actions).
 */
export class GetInventoryUseCase {
  constructor(private readonly deps: GetInventoryDeps) {}

  async execute(input: GetInventoryInput): Promise<Inventory> {
    const inventory = await this.deps.inventoryRepository.findByProductAndVariant(
      input.productId,
      input.variantId,
    );
    if (!inventory) {
      throw new InventoryNotFoundError();
    }
    return inventory;
  }
}
