import {
  toUuid,
  type Clock,
  type IdGenerator,
  type Logger,
  type Money,
  type TransactionRunner,
} from '@leen-mart/domain-kit';
import type { AuditWriter } from '../../../audit/index.js';
import type { Principal } from '../../../identity/index.js';
import {
  CATALOGUE_AUDIT_ACTIONS,
  CATALOGUE_AUDIT_ENTITY_TYPES,
} from '../../domain/audit-actions.js';
import { Inventory } from '../../domain/entities/inventory.entity.js';
import { ProductVariant } from '../../domain/entities/product-variant.entity.js';
import { ProductNotFoundError } from '../../domain/errors/catalogue-errors.js';
import type { ProductRepository } from '../../domain/repositories/product.repository.js';
import type { InventoryRepository } from '../../domain/repositories/inventory.repository.js';
import type { ProductVariantRepository } from '../../domain/repositories/product-variant.repository.js';
import type { ProductId } from '../../domain/value-objects/product-id.value-object.js';
import { toProductVariantId } from '../../domain/value-objects/product-variant-id.value-object.js';

export interface AddProductVariantInput {
  readonly principal: Principal;
  readonly productId: ProductId;
  readonly sku: string;
  readonly name: string;
  readonly price: Money;
  readonly unitOfMeasure: string;
  readonly quantityStep: number;
}

export interface AddProductVariantResult {
  readonly variant: ProductVariant;
}

export interface AddProductVariantDeps {
  readonly productRepository: ProductRepository;
  readonly productVariantRepository: ProductVariantRepository;
  /** A variant is never created without its counter (S2-4 D-E). */
  readonly inventoryRepository: InventoryRepository;
  readonly transactionRunner: TransactionRunner;
  readonly auditWriter: AuditWriter;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
  readonly logger: Logger;
}

/**
 * Adds a variant to one of the caller's own products.
 *
 * The product is loaded through the tenant-scoped repository, so a product
 * belonging to another vendor reads as absent — a vendor cannot attach a
 * variant to someone else's listing, and cannot learn that the listing exists
 * either.
 *
 * It takes the same parent-row lock `RemoveProductVariantUseCase` does. This
 * addition does not itself need serialising, but ordering it against
 * concurrent removals is what stops an add and a last-variant delete from
 * interleaving into a state neither of them observed.
 *
 * SKU uniqueness is the database's to arbitrate — `uq_product_variants_vendor_sku`,
 * translated by the repository into `ProductVariantSkuConflictError` (S2-3 D-5).
 * A pre-flight read would still lose to a concurrent create.
 */
export class AddProductVariantUseCase {
  constructor(private readonly deps: AddProductVariantDeps) {}

  async execute(input: AddProductVariantInput): Promise<AddProductVariantResult> {
    const {
      productRepository,
      productVariantRepository,
      inventoryRepository,
      transactionRunner,
      auditWriter,
      idGenerator,
      clock,
      logger,
    } = this.deps;

    return transactionRunner.run(async (scope) => {
      const products = productRepository.withTransaction(scope);
      const now = clock.now();

      if (!(await products.lockForVariantChange(input.productId, now))) {
        throw new ProductNotFoundError();
      }

      const product = await products.findById(input.productId);
      /* c8 ignore next 3 */
      if (!product) {
        throw new ProductNotFoundError(); // unreachable: the lock above already proved it live
      }

      const variant = ProductVariant.create({
        id: toProductVariantId(idGenerator.generate()),
        productId: product.id,
        // From the product, never from the request: a variant's vendor is
        // whoever owns its product, and the composite foreign key refuses any
        // other answer anyway.
        vendorId: product.vendorId,
        sku: input.sku,
        name: input.name,
        price: input.price,
        unitOfMeasure: input.unitOfMeasure,
        quantityStep: input.quantityStep,
        now,
      });

      await productVariantRepository.withTransaction(scope).create(variant);
      // Same transaction: if this fails, the variant never happened either.
      await inventoryRepository
        .withTransaction(scope)
        .create(Inventory.initial({ variantId: variant.id, vendorId: variant.vendorId, now }));

      await auditWriter.withTransaction(scope).record({
        actorId: input.principal.userId,
        actorRole: input.principal.role,
        action: CATALOGUE_AUDIT_ACTIONS.PRODUCT_VARIANT_ADDED,
        entityType: CATALOGUE_AUDIT_ENTITY_TYPES.PRODUCT,
        entityId: toUuid(product.id),
        after: { variantId: variant.id, sku: variant.sku, name: variant.name },
      });

      logger.info({ productId: product.id, variantId: variant.id }, 'Product variant added');

      return { variant };
    });
  }
}
