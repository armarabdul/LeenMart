import { toUuid, type Clock, type Logger, type TransactionRunner } from '@leen-mart/domain-kit';
import type { AuditWriter } from '../../../audit/index.js';
import type { Principal } from '../../../identity/index.js';
import {
  CATALOGUE_AUDIT_ACTIONS,
  CATALOGUE_AUDIT_ENTITY_TYPES,
} from '../../domain/audit-actions.js';
import type { Product } from '../../domain/entities/product.entity.js';
import { ProductNotFoundError } from '../../domain/errors/catalogue-errors.js';
import type { InventoryRepository } from '../../domain/repositories/inventory.repository.js';
import type { ProductRepository } from '../../domain/repositories/product.repository.js';
import type { ProductVariantRepository } from '../../domain/repositories/product-variant.repository.js';
import type { ProductId } from '../../domain/value-objects/product-id.value-object.js';

export interface DeleteProductInput {
  readonly principal: Principal;
  readonly productId: ProductId;
}

export interface DeleteProductResult {
  readonly product: Product;
  readonly variantsRemoved: number;
}

export interface DeleteProductDeps {
  readonly productRepository: ProductRepository;
  readonly productVariantRepository: ProductVariantRepository;
  /** Counters are removed outright with their variants — they carry no `deleted_at`. */
  readonly inventoryRepository: InventoryRepository;
  readonly transactionRunner: TransactionRunner;
  readonly auditWriter: AuditWriter;
  readonly clock: Clock;
  readonly logger: Logger;
}

/**
 * Soft-deletes one of the caller's own products and every variant beneath it,
 * in one transaction (SDD 6.1: `deleted_at`; hard delete only via a DPDP
 * erasure job).
 *
 * Variants go with the product rather than blocking it, which is the opposite
 * of `DeleteCategoryUseCase`'s rule for subcategories — and the difference is
 * the point. A subcategory is its own thing; a variant is *part of* its
 * product, and SDD 6.3 makes every product have at least one, so a product
 * can never be emptied of variants first. Leaving them behind would strand
 * rows no surface could reach.
 *
 * Ordering is deliberate: the conditional product delete runs first and is the
 * arbiter, so a caller that lost a race to a concurrent delete gets a 404 and
 * touches no variant.
 */
export class DeleteProductUseCase {
  constructor(private readonly deps: DeleteProductDeps) {}

  async execute(input: DeleteProductInput): Promise<DeleteProductResult> {
    const {
      productRepository,
      productVariantRepository,
      inventoryRepository,
      transactionRunner,
      auditWriter,
      clock,
      logger,
    } = this.deps;

    return transactionRunner.run(async (scope) => {
      const repository = productRepository.withTransaction(scope);

      const existing = await repository.findById(input.productId);
      if (!existing) {
        throw new ProductNotFoundError();
      }

      const now = clock.now();
      const deleted = existing.softDelete(now);
      if (!(await repository.softDelete(deleted))) {
        throw new ProductNotFoundError();
      }

      // Only the winner of the conditional delete reaches here, so a lost race
      // never touches a variant. Same timestamp as the product, so the two
      // agree on when they went.
      const variantsRemoved = await productVariantRepository
        .withTransaction(scope)
        .softDeleteAllForProduct(deleted.id, now);

      // Genuinely deleted, not soft-deleted: a counter belongs to its variant
      // rather than having a lifecycle of its own, and leaving one behind
      // would strand a row nothing could ever reach again.
      await inventoryRepository.withTransaction(scope).deleteForProduct(deleted.id);

      await auditWriter.withTransaction(scope).record({
        actorId: input.principal.userId,
        actorRole: input.principal.role,
        action: CATALOGUE_AUDIT_ACTIONS.PRODUCT_DELETED,
        entityType: CATALOGUE_AUDIT_ENTITY_TYPES.PRODUCT,
        entityId: toUuid(deleted.id),
        before: { name: existing.name, categoryId: existing.categoryId, variantsRemoved },
      });

      logger.info({ productId: deleted.id, variantsRemoved }, 'Product deleted');

      return { product: deleted, variantsRemoved };
    });
  }
}
