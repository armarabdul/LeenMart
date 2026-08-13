import type { Clock, IdGenerator, Logger, Money, TransactionRunner } from '@leen-mart/domain-kit';
import { toUuid } from '@leen-mart/domain-kit';
import type { AuditWriter } from '../../../audit/index.js';
import type { Principal, VendorId } from '../../../identity/index.js';
import {
  CATALOGUE_AUDIT_ACTIONS,
  CATALOGUE_AUDIT_ENTITY_TYPES,
} from '../../domain/audit-actions.js';
import { Product, type ProductAttributeValues } from '../../domain/entities/product.entity.js';
import { Inventory } from '../../domain/entities/inventory.entity.js';
import { ProductVariant } from '../../domain/entities/product-variant.entity.js';
import { CategoryNotFoundError } from '../../domain/errors/catalogue-errors.js';
import type { CategoryRepository } from '../../domain/repositories/category.repository.js';
import type { ProductRepository } from '../../domain/repositories/product.repository.js';
import type { InventoryRepository } from '../../domain/repositories/inventory.repository.js';
import type { ProductVariantRepository } from '../../domain/repositories/product-variant.repository.js';
import type { CategoryId } from '../../domain/value-objects/category-id.value-object.js';
import { toProductId } from '../../domain/value-objects/product-id.value-object.js';
import { toProductVariantId } from '../../domain/value-objects/product-variant-id.value-object.js';

/** The one variant every new product must carry (S2-3 D-7). */
export interface CreateProductVariantInput {
  readonly sku: string;
  readonly name: string;
  readonly price: Money;
  readonly unitOfMeasure: string;
  readonly quantityStep: number;
}

export interface CreateProductInput {
  readonly principal: Principal;
  /**
   * Already resolved — by `tenantContext` upstream in production, by the
   * caller directly in a test. This use case never re-derives it: doing so
   * would mean importing the `vendor` module's own repository, which SDD 5.1
   * forbids `catalogue` from depending on (S2-3 D-1).
   */
  readonly vendorId: VendorId;
  readonly categoryId: CategoryId;
  readonly name: string;
  readonly brand: string | null;
  readonly description: string | null;
  readonly hsnCode: string | null;
  readonly countryOfOrigin: string | null;
  readonly netQuantity: string | null;
  readonly attributeValues: ProductAttributeValues;
  readonly variant: CreateProductVariantInput;
}

export interface CreateProductResult {
  readonly product: Product;
  readonly variant: ProductVariant;
}

export interface CreateProductDeps {
  readonly productRepository: ProductRepository;
  readonly productVariantRepository: ProductVariantRepository;
  /**
   * Every variant is created with a counter, in this same transaction (S2-4
   * D-E) — so a sellable unit can never exist without stock to sell, the same
   * "never half a thing" reasoning D-7 applies to a product and its variant.
   */
  readonly inventoryRepository: InventoryRepository;
  /**
   * Categories are platform-owned, not tenant-scoped (S2-2a) — this is the
   * same `CategoryRepository` the admin and public surfaces use, just bound
   * to a client that can see the category the caller named.
   */
  readonly categoryRepository: CategoryRepository;
  readonly transactionRunner: TransactionRunner;
  readonly auditWriter: AuditWriter;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
  readonly logger: Logger;
}

/**
 * Creates a product and its first variant together, in one transaction
 * (S2-3 D-7). "Every product has at least one (default) variant" (SDD 6.3)
 * is not a constraint a single-row `INSERT` could express — a two-step
 * "create product, then add a variant" API would let a product exist,
 * however briefly, with none. This use case is what makes that impossible:
 * both rows land together, or neither does.
 *
 * `status` is not part of the input and is not settable here — `Product`
 * only ever constructs itself as `DRAFT` in S2-3a, and this use case does
 * not anticipate the submission/moderation flow that will one day move it.
 *
 * `hsnCode`/`countryOfOrigin`/`netQuantity` are accepted and stored as given
 * (subject only to `Product`'s own shape checks) — never validated against
 * the category's `requirements` flags (S2-3 D-2). Whether they are
 * *required* for this category is the submission flow's question, and it
 * does not exist yet.
 */
export class CreateProductUseCase {
  constructor(private readonly deps: CreateProductDeps) {}

  /** Builds both entities without persisting anything — split out purely to keep `execute` under this file's line budget. */
  private buildEntities(input: CreateProductInput, now: Date): CreateProductResult {
    const product = Product.create({
      id: toProductId(this.deps.idGenerator.generate()),
      vendorId: input.vendorId,
      categoryId: input.categoryId,
      name: input.name,
      brand: input.brand,
      description: input.description,
      hsnCode: input.hsnCode,
      countryOfOrigin: input.countryOfOrigin,
      netQuantity: input.netQuantity,
      attributeValues: input.attributeValues,
      now,
    });
    const variant = ProductVariant.create({
      id: toProductVariantId(this.deps.idGenerator.generate()),
      productId: product.id,
      vendorId: input.vendorId,
      sku: input.variant.sku,
      name: input.variant.name,
      price: input.variant.price,
      unitOfMeasure: input.variant.unitOfMeasure,
      quantityStep: input.variant.quantityStep,
      now,
    });
    return { product, variant };
  }

  async execute(input: CreateProductInput): Promise<CreateProductResult> {
    const {
      productRepository,
      productVariantRepository,
      inventoryRepository,
      categoryRepository,
      transactionRunner,
      auditWriter,
      clock,
      logger,
    } = this.deps;

    // Read before the transaction opens, the same discipline
    // `AccessKycDocumentUseCase`/`SubmitVendorKycUseCase` already follow: a
    // request naming a category that does not exist should never cost a
    // database write.
    const category = await categoryRepository.findById(input.categoryId);
    if (!category) {
      throw new CategoryNotFoundError();
    }

    const now = clock.now();
    const { product, variant } = this.buildEntities(input, now);

    // One transaction over two repositories and the audit write, the same
    // shape `DeleteCategoryUseCase` uses for a category and its attributes:
    // all three land or none does.
    await transactionRunner.run(async (scope) => {
      await productRepository.withTransaction(scope).create(product);
      await productVariantRepository.withTransaction(scope).create(variant);
      await inventoryRepository
        .withTransaction(scope)
        .create(Inventory.initial({ variantId: variant.id, vendorId: variant.vendorId, now }));
      await auditWriter.withTransaction(scope).record({
        actorId: input.principal.userId,
        actorRole: input.principal.role,
        action: CATALOGUE_AUDIT_ACTIONS.PRODUCT_CREATED,
        entityType: CATALOGUE_AUDIT_ENTITY_TYPES.PRODUCT,
        entityId: toUuid(product.id),
        after: {
          vendorId: product.vendorId,
          categoryId: product.categoryId,
          name: product.name,
          variant: { id: variant.id, sku: variant.sku },
        },
      });
    });

    logger.info(
      { productId: product.id, vendorId: product.vendorId, variantId: variant.id },
      'Product created',
    );

    return { product, variant };
  }
}
