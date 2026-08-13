import { toUuid, type Clock, type Logger, type TransactionRunner } from '@leen-mart/domain-kit';
import type { AuditWriter } from '../../../audit/index.js';
import type { Principal } from '../../../identity/index.js';
import {
  CATALOGUE_AUDIT_ACTIONS,
  CATALOGUE_AUDIT_ENTITY_TYPES,
} from '../../domain/audit-actions.js';
import type {
  ProductVariant,
  ProductVariantDetailChanges,
} from '../../domain/entities/product-variant.entity.js';
import { ProductVariantNotFoundError } from '../../domain/errors/catalogue-errors.js';
import type { ProductVariantRepository } from '../../domain/repositories/product-variant.repository.js';
import type { ProductId } from '../../domain/value-objects/product-id.value-object.js';
import type { ProductVariantId } from '../../domain/value-objects/product-variant-id.value-object.js';

export interface UpdateProductVariantInput {
  readonly principal: Principal;
  readonly productId: ProductId;
  readonly variantId: ProductVariantId;
  readonly changes: ProductVariantDetailChanges;
}

export interface UpdateProductVariantResult {
  readonly variant: ProductVariant;
}

export interface UpdateProductVariantDeps {
  readonly productVariantRepository: ProductVariantRepository;
  readonly transactionRunner: TransactionRunner;
  readonly auditWriter: AuditWriter;
  readonly clock: Clock;
  readonly logger: Logger;
}

const hasChanges = (changes: ProductVariantDetailChanges): boolean =>
  Object.values(changes).some((value) => value !== undefined);

/**
 * A partial edit of one variant of one of the caller's own products.
 *
 * Looked up by **both** ids, so a variant id that is real but hangs off a
 * different product — even another of this same vendor's — reads as absent
 * rather than as a hint that a valid id was aimed at the wrong parent.
 *
 * No parent-row lock here: this changes no variant's existence, so it cannot
 * affect how many a product has, which is the only thing that lock protects.
 *
 * `sku` is not among the changes and `ProductVariant` has no mutator for it —
 * S2-3a's decision, preserved rather than revisited.
 */
export class UpdateProductVariantUseCase {
  constructor(private readonly deps: UpdateProductVariantDeps) {}

  async execute(input: UpdateProductVariantInput): Promise<UpdateProductVariantResult> {
    const { productVariantRepository, transactionRunner, auditWriter, clock, logger } = this.deps;

    return transactionRunner.run(async (scope) => {
      const repository = productVariantRepository.withTransaction(scope);

      const existing = await repository.findByProductAndId(input.productId, input.variantId);
      if (!existing) {
        throw new ProductVariantNotFoundError();
      }

      const variant = existing.updateDetails(input.changes, clock.now());
      if (!(await repository.update(variant))) {
        throw new ProductVariantNotFoundError();
      }

      if (hasChanges(input.changes)) {
        await auditWriter.withTransaction(scope).record({
          actorId: input.principal.userId,
          actorRole: input.principal.role,
          action: CATALOGUE_AUDIT_ACTIONS.PRODUCT_VARIANT_UPDATED,
          entityType: CATALOGUE_AUDIT_ENTITY_TYPES.PRODUCT,
          entityId: toUuid(input.productId),
          before: {
            variantId: existing.id,
            sku: existing.sku,
            name: existing.name,
            priceAmount: existing.price.amountMinor.toString(),
          },
          after: {
            variantId: variant.id,
            sku: variant.sku,
            name: variant.name,
            priceAmount: variant.price.amountMinor.toString(),
          },
        });
      }

      logger.info({ productId: input.productId, variantId: variant.id }, 'Product variant updated');

      return { variant };
    });
  }
}
