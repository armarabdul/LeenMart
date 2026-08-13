import { toUuid, type Clock, type Logger, type TransactionRunner } from '@leen-mart/domain-kit';
import type { AuditWriter } from '../../../audit/index.js';
import type { Principal } from '../../../identity/index.js';
import {
  CATALOGUE_AUDIT_ACTIONS,
  CATALOGUE_AUDIT_ENTITY_TYPES,
} from '../../domain/audit-actions.js';
import type { Inventory } from '../../domain/entities/inventory.entity.js';
import {
  InventoryNotFoundError,
  InventoryVersionConflictError,
} from '../../domain/errors/catalogue-errors.js';
import type { InventoryRepository } from '../../domain/repositories/inventory.repository.js';
import type { ProductId } from '../../domain/value-objects/product-id.value-object.js';
import type { ProductVariantId } from '../../domain/value-objects/product-variant-id.value-object.js';

export interface SetInventoryInput {
  readonly principal: Principal;
  readonly productId: ProductId;
  readonly variantId: ProductVariantId;
  readonly available: number;
  /** The version the vendor read before editing. A stale one is refused. */
  readonly expectedVersion: number;
}

export interface SetInventoryResult {
  readonly inventory: Inventory;
}

export interface SetInventoryDeps {
  readonly inventoryRepository: InventoryRepository;
  readonly transactionRunner: TransactionRunner;
  readonly auditWriter: AuditWriter;
  readonly clock: Clock;
  readonly logger: Logger;
}

/**
 * A vendor setting the stock level on one of their own variants (S2-4).
 *
 * **Absolute, and guarded by `version`** (S2-4 D-B). The vendor sends the
 * figure they want and the version they read it at; the conditional write
 * lands only if nothing moved in between. Two staff editing the same variant
 * therefore cannot silently overwrite one another — the loser gets a 409 and
 * can reload, which for a stock figure is the difference between a visible
 * failure and quietly wrong numbers.
 *
 * The guard is in the `WHERE` clause, never a prior read: a check performed
 * here would already be stale by the time the write ran.
 *
 * **This is not the checkout path.** SDD 14.4 prescribes a single atomic
 * conditional `UPDATE … WHERE available >= :qty` for the decrement, backed by
 * `chk_inventory_available_non_negative`. That path is Stage 3's and must not
 * route through this version guard — under contention every concurrent buyer
 * would collide with every other rather than with the stock figure, which is
 * exactly the serialise-or-oversell problem §14.4 exists to avoid.
 */
export class SetInventoryUseCase {
  constructor(private readonly deps: SetInventoryDeps) {}

  async execute(input: SetInventoryInput): Promise<SetInventoryResult> {
    const { inventoryRepository, transactionRunner, auditWriter, clock, logger } = this.deps;

    return transactionRunner.run(async (scope) => {
      const repository = inventoryRepository.withTransaction(scope);

      const existing = await repository.findByProductAndVariant(input.productId, input.variantId);
      if (!existing) {
        throw new InventoryNotFoundError();
      }

      const updated = existing.set(input.available, clock.now());
      if (!(await repository.setIfVersionMatches(updated, input.expectedVersion))) {
        // Either someone else wrote first, or the caller sent a version that
        // was never current. Both are the same answer: reload and retry.
        throw new InventoryVersionConflictError();
      }

      await auditWriter.withTransaction(scope).record({
        actorId: input.principal.userId,
        actorRole: input.principal.role,
        action: CATALOGUE_AUDIT_ACTIONS.PRODUCT_INVENTORY_UPDATED,
        entityType: CATALOGUE_AUDIT_ENTITY_TYPES.PRODUCT,
        entityId: toUuid(input.productId),
        before: { variantId: existing.variantId, available: existing.available },
        after: { variantId: updated.variantId, available: updated.available },
      });

      logger.info(
        { productId: input.productId, variantId: updated.variantId, available: updated.available },
        'Inventory updated',
      );

      return { inventory: updated };
    });
  }
}
