import { toUuid, type Clock, type Logger, type TransactionRunner } from '@leen-mart/domain-kit';
import type { AuditWriter } from '../../../audit/index.js';
import type { Principal } from '../../../identity/index.js';
import {
  CATALOGUE_AUDIT_ACTIONS,
  CATALOGUE_AUDIT_ENTITY_TYPES,
} from '../../domain/audit-actions.js';
import type { Product } from '../../domain/entities/product.entity.js';
import {
  ProductAlreadyDecidedError,
  ProductMediaNotReadyError,
  ProductNotFoundError,
} from '../../domain/errors/catalogue-errors.js';
import { ProductRejectionReason } from '../../domain/value-objects/product-rejection-reason.value-object.js';
import type { ProductRepository } from '../../domain/repositories/product.repository.js';
import type { ProductMediaRepository } from '../../domain/repositories/product-media.repository.js';
import type { ProductId } from '../../domain/value-objects/product-id.value-object.js';

/**
 * A discriminated command rather than two use cases: the two outcomes share
 * every step except one domain call, mirroring `KycDecisionCommand` exactly.
 *
 * `note` is optional on `REJECT`, the same shape `KycDecisionCommand` uses —
 * SDD 15.2: "a structured reason code plus optional free text". `reason` is
 * the one field that is never optional.
 */
export type ProductDecisionCommand =
  | { readonly decision: 'APPROVE' }
  | {
      readonly decision: 'REJECT';
      readonly reason: string;
      readonly note?: string | undefined;
    };

export interface DecideProductInput {
  readonly principal: Principal;
  readonly productId: ProductId;
  readonly command: ProductDecisionCommand;
}

export interface DecideProductResult {
  readonly product: Product;
}

export interface DecideProductDeps {
  readonly productRepository: ProductRepository;
  /**
   * Read-only here (S2-8, SDD 12.2 step 6) — this use case never writes a
   * media row. Built on the same `adminPrisma` credential as
   * `productRepository`: `product_media_admin_read`'s `USING (true)` policy
   * exists for exactly this cross-tenant admin read (its own migration
   * comment names the future need explicitly), mirroring how
   * `products_admin_read` already lets this use case read the product row
   * itself on that credential — not a new privilege, the one already
   * provisioned for it.
   */
  readonly productMediaRepository: ProductMediaRepository;
  readonly transactionRunner: TransactionRunner;
  readonly auditWriter: AuditWriter;
  readonly clock: Clock;
  readonly logger: Logger;
}

/** Kept out of `execute` so the transaction body stays readable at a glance. */
const decide = (product: Product, input: DecideProductInput, now: Date): Product => {
  if (input.command.decision === 'APPROVE') {
    return product.approve(now);
  }
  // `fromName` rejects anything outside the closed set; the domain refuses
  // independently of the wire, the same discipline `KycRejectionReason.fromName`
  // establishes.
  return product.reject(
    ProductRejectionReason.fromName(input.command.reason),
    input.command.note ?? null,
    now,
  );
};

/**
 * An administrator's product moderation decision (SDD 15.2).
 *
 * **There is deliberately no claim step ahead of this** (S2-5 D-5-D) — unlike
 * `DecideVendorKycUseCase`, which follows `StartKycReviewUseCase`'s claim.
 * The conditional write below (`decideIfPendingReview`) is the only
 * arbitration S2-5 needs: two administrators may both load the same
 * `PENDING_REVIEW` product, and only one `UPDATE ... WHERE status =
 * 'PENDING_REVIEW'` can affect it.
 *
 * One transaction, on the admin credential — a decision is a single row's
 * status changing, unlike KYC's decision which also transitions the vendor's
 * separate lifecycle state, so there is only one product repository here;
 * `productMediaRepository` is a second, read-only one (S2-8).
 *
 * **The media-readiness gate (S2-8, SDD 12.2 step 6)** runs only for
 * `APPROVE`, and only *after* the domain has already confirmed the decision
 * is legal — a product outside `PENDING_REVIEW` still answers with the
 * ordinary "must be in PENDING_REVIEW" error, never a media one that would
 * be true but beside the point.
 */
export class DecideProductUseCase {
  constructor(private readonly deps: DecideProductDeps) {}

  async execute(input: DecideProductInput): Promise<DecideProductResult> {
    const {
      productRepository,
      productMediaRepository,
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
      // Domain first: it owns "may this be decided at all?" and throws for a
      // product outside `PENDING_REVIEW`, or a rejection with a blank note.
      const decided = decide(existing, input, now);

      if (input.command.decision === 'APPROVE') {
        await this.assertMediaReady(productMediaRepository.withTransaction(scope), existing.id);
      }

      // Then the race the domain cannot see. Both administrators may have
      // loaded the same `PENDING_REVIEW` row before either wrote; only one
      // conditional update can flip `status` away from it.
      if (!(await repository.decideIfPendingReview(decided))) {
        throw new ProductAlreadyDecidedError();
      }

      // Only the winner reaches here — the loser threw above and this
      // transaction never opened for them, so a lost race writes no audit
      // row. The coded reason travels on a rejection; the free-text note
      // never does — it is a reviewer's prose about a named vendor's
      // listing, not a lifecycle fact, the same restraint
      // `DecideVendorKycUseCase` applies.
      await auditWriter.withTransaction(scope).record({
        actorId: input.principal.userId,
        actorRole: input.principal.role,
        action:
          input.command.decision === 'APPROVE'
            ? CATALOGUE_AUDIT_ACTIONS.PRODUCT_APPROVED
            : CATALOGUE_AUDIT_ACTIONS.PRODUCT_REJECTED,
        entityType: CATALOGUE_AUDIT_ENTITY_TYPES.PRODUCT,
        entityId: toUuid(decided.id),
        reason: decided.rejectionReason?.name ?? null,
        before: { status: existing.status },
        after: { status: decided.status },
      });

      logger.info(
        { productId: decided.id, decision: input.command.decision },
        'Admin recorded a product moderation decision',
      );

      return { product: decided };
    });
  }

  /**
   * SDD 12.2 step 6 (S2-8): refuses approval unless the product has at least
   * one live `READY` media item and no live item in any other status.
   * `listByProductId` already excludes soft-deleted rows, which is what
   * makes "only deleted media" and "a live READY item plus a deleted
   * PROCESSING/FAILED one" resolve correctly with no extra filtering here —
   * a deleted row simply never appears in `items`.
   */
  private async assertMediaReady(
    media: ProductMediaRepository,
    productId: ProductId,
  ): Promise<void> {
    const items = await media.listByProductId(productId);
    if (items.length === 0 || items.some((item) => item.status !== 'READY')) {
      throw new ProductMediaNotReadyError();
    }
  }
}
