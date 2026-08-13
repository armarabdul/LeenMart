import { toUuid, type Clock, type Logger, type TransactionRunner } from '@leen-mart/domain-kit';
import type { AuditWriter } from '../../../audit/index.js';
import type { Principal } from '../../../identity/index.js';
import {
  CATALOGUE_AUDIT_ACTIONS,
  CATALOGUE_AUDIT_ENTITY_TYPES,
} from '../../domain/audit-actions.js';
import type { ProductVariant } from '../../domain/entities/product-variant.entity.js';
import {
  ProductLastVariantError,
  ProductNotFoundError,
  ProductVariantNotFoundError,
} from '../../domain/errors/catalogue-errors.js';
import type { InventoryRepository } from '../../domain/repositories/inventory.repository.js';
import type { ProductRepository } from '../../domain/repositories/product.repository.js';
import type { ProductVariantRepository } from '../../domain/repositories/product-variant.repository.js';
import type { ProductId } from '../../domain/value-objects/product-id.value-object.js';
import type { ProductVariantId } from '../../domain/value-objects/product-variant-id.value-object.js';

export interface RemoveProductVariantInput {
  readonly principal: Principal;
  readonly productId: ProductId;
  readonly variantId: ProductVariantId;
}

export interface RemoveProductVariantResult {
  readonly variant: ProductVariant;
}

export interface RemoveProductVariantDeps {
  readonly productRepository: ProductRepository;
  readonly productVariantRepository: ProductVariantRepository;
  /** The counter goes with the variant, in this same transaction. */
  readonly inventoryRepository: InventoryRepository;
  readonly transactionRunner: TransactionRunner;
  readonly auditWriter: AuditWriter;
  readonly clock: Clock;
  readonly logger: Logger;
}

/**
 * Soft-deletes one variant, unless it is the product's last live one.
 *
 * **The invariant is enforced with a lock, not a count.** "A product keeps at
 * least one variant" (SDD 6.3) spans rows, so no single-statement condition
 * can hold it: two concurrent deletes of the final two variants would each
 * count two live rows, each pass its own check, and each commit — leaving a
 * product no one can buy from but which still appears to exist.
 *
 * So the parent product row is taken as the serialisation point.
 * `lockForVariantChange` issues an `UPDATE` against it, which PostgreSQL holds
 * as an exclusive row lock until this transaction ends. A second variant
 * deletion for the same product blocks there, and by the time it counts, it
 * sees the first transaction's committed result — one succeeds, the other gets
 * the 409.
 *
 * The same lock orders variant *additions* against deletions, so a variant
 * added concurrently with the removal of the last one cannot interleave into a
 * state where neither saw the other.
 */
export class RemoveProductVariantUseCase {
  constructor(private readonly deps: RemoveProductVariantDeps) {}

  async execute(input: RemoveProductVariantInput): Promise<RemoveProductVariantResult> {
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
      const products = productRepository.withTransaction(scope);
      const variants = productVariantRepository.withTransaction(scope);
      const now = clock.now();

      // First, and before anything is read: everything below is only true for
      // as long as this lock is held.
      if (!(await products.lockForVariantChange(input.productId, now))) {
        throw new ProductNotFoundError();
      }

      const existing = await variants.findByProductAndId(input.productId, input.variantId);
      if (!existing) {
        throw new ProductVariantNotFoundError();
      }

      // Read under the lock, so it cannot be stale by the time the delete runs.
      if ((await variants.countLiveForProduct(input.productId)) <= 1) {
        throw new ProductLastVariantError();
      }

      const deleted = existing.softDelete(now);
      if (!(await variants.softDelete(deleted))) {
        throw new ProductVariantNotFoundError();
      }

      // Only the winner of the conditional soft-delete reaches here, so a
      // refused removal never strands or orphans a counter.
      await inventoryRepository.withTransaction(scope).deleteForVariants([deleted.id]);

      await auditWriter.withTransaction(scope).record({
        actorId: input.principal.userId,
        actorRole: input.principal.role,
        action: CATALOGUE_AUDIT_ACTIONS.PRODUCT_VARIANT_REMOVED,
        entityType: CATALOGUE_AUDIT_ENTITY_TYPES.PRODUCT,
        entityId: toUuid(input.productId),
        before: { variantId: existing.id, sku: existing.sku, name: existing.name },
      });

      logger.info({ productId: input.productId, variantId: deleted.id }, 'Product variant removed');

      return { variant: deleted };
    });
  }
}
