import { toUuid, type Clock, type Logger, type TransactionRunner } from '@leen-mart/domain-kit';
import type { AuditWriter } from '../../../audit/index.js';
import type { Principal } from '../../../identity/index.js';
import {
  CATALOGUE_AUDIT_ACTIONS,
  CATALOGUE_AUDIT_ENTITY_TYPES,
} from '../../domain/audit-actions.js';
import type { Product, ProductDetailChanges } from '../../domain/entities/product.entity.js';
import {
  CategoryNotFoundError,
  ProductNotFoundError,
} from '../../domain/errors/catalogue-errors.js';
import type { CategoryRepository } from '../../domain/repositories/category.repository.js';
import type { ProductRepository } from '../../domain/repositories/product.repository.js';
import type { ProductId } from '../../domain/value-objects/product-id.value-object.js';

export interface UpdateProductInput {
  readonly principal: Principal;
  readonly productId: ProductId;
  readonly changes: ProductDetailChanges;
}

export interface UpdateProductResult {
  readonly product: Product;
}

export interface UpdateProductDeps {
  readonly productRepository: ProductRepository;
  readonly categoryRepository: CategoryRepository;
  readonly transactionRunner: TransactionRunner;
  readonly auditWriter: AuditWriter;
  readonly clock: Clock;
  readonly logger: Logger;
}

const hasChanges = (changes: ProductDetailChanges): boolean =>
  Object.values(changes).some((value) => value !== undefined);

/**
 * A partial edit of one of the caller's own products (SDD 9.2's `PATCH`
 * semantics).
 *
 * The product is found through the tenant-scoped repository, so another
 * vendor's id reads as absent exactly the way a nonexistent one does — the
 * 404 below is the same answer in both cases, and deliberately so (SDD 6.6).
 *
 * Moving a product to another category re-checks that the category exists,
 * the same read `CreateProductUseCase` performs — a `categoryId` naming
 * nothing must fail before it costs a write. It does **not** re-validate the
 * product against the new category's requirement flags: that is the
 * submission flow's question and it does not exist yet (S2-3 D-2).
 *
 * `status` cannot be reached from here. `ProductDetailChanges` has no such
 * field and `Product` has no mutator for it.
 */
export class UpdateProductUseCase {
  constructor(private readonly deps: UpdateProductDeps) {}

  async execute(input: UpdateProductInput): Promise<UpdateProductResult> {
    const { productRepository, categoryRepository, transactionRunner, auditWriter, clock, logger } =
      this.deps;

    if (input.changes.categoryId !== undefined) {
      const category = await categoryRepository.findById(input.changes.categoryId);
      if (!category) {
        throw new CategoryNotFoundError();
      }
    }

    return transactionRunner.run(async (scope) => {
      const repository = productRepository.withTransaction(scope);

      const existing = await repository.findById(input.productId);
      if (!existing) {
        throw new ProductNotFoundError();
      }

      const product = existing.updateDetails(input.changes, clock.now());
      if (!(await repository.update(product))) {
        // Vanished between the read and the write — the same answer a caller
        // gets for an id that was never there.
        throw new ProductNotFoundError();
      }

      if (hasChanges(input.changes)) {
        await auditWriter.withTransaction(scope).record({
          actorId: input.principal.userId,
          actorRole: input.principal.role,
          action: CATALOGUE_AUDIT_ACTIONS.PRODUCT_UPDATED,
          entityType: CATALOGUE_AUDIT_ENTITY_TYPES.PRODUCT,
          entityId: toUuid(product.id),
          before: { categoryId: existing.categoryId, name: existing.name },
          after: { categoryId: product.categoryId, name: product.name },
        });
      }

      logger.info({ productId: product.id, vendorId: product.vendorId }, 'Product updated');

      return { product };
    });
  }
}
