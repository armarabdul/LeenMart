import type { Clock, IdGenerator, Logger, TransactionRunner } from '@leen-mart/domain-kit';
import { toUuid } from '@leen-mart/domain-kit';
import type { AuditWriter } from '../../../audit/index.js';
import type { Principal, VendorId } from '../../../identity/index.js';
import type { ProductVariantId } from '../../../catalogue/index.js';
import type { ProductVariantRepository } from '../../../catalogue/domain/repositories/product-variant.repository.js';
import { PREORDER_AUDIT_ACTIONS, PREORDER_AUDIT_ENTITY_TYPES } from '../../domain/audit-actions.js';
import { PreorderCampaign } from '../../domain/entities/preorder-campaign.entity.js';
import { VariantNotEligibleForCampaignError } from '../../domain/errors/preorder-errors.js';
import type { CampaignRepository } from '../../domain/repositories/campaign.repository.js';
import { toCampaignId } from '../../domain/value-objects/campaign-id.value-object.js';
import { CampaignFulfilmentMode } from '../../domain/value-objects/campaign-fulfilment-mode.value-object.js';

export interface CreateCampaignInput {
  readonly principal: Principal;
  /** Already resolved by `tenantContext` upstream — the same `CreateProductInput.vendorId` precedent (`catalogue`'s own doc comment: re-deriving it here would mean importing `vendor`'s own repository, which SDD 5.1 forbids). */
  readonly vendorId: VendorId;
  readonly variantId: ProductVariantId;
  readonly opensAt: Date;
  readonly orderCutoffAt: Date;
  readonly fulfilmentWindowStart: Date;
  readonly fulfilmentWindowEnd: Date;
  readonly totalQuantity: number;
  readonly advancePercent: number;
  readonly maxPerCustomer: number;
  readonly fulfilmentMode: 'DELIVERY' | 'PICKUP' | 'BOTH';
}

export interface CreateCampaignDeps {
  readonly campaignRepository: CampaignRepository;
  /** `publicPrisma`-bound (S2-7's own eligibility-proof pattern: `findById` returning non-null under `leenmart_public` RLS *is* the eligibility check) — the exact `AddCartItemUseCase` precedent for reaching `catalogue` without an illegal cross-module import. */
  readonly productVariantRepository: ProductVariantRepository;
  readonly transactionRunner: TransactionRunner;
  readonly auditWriter: AuditWriter;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
  readonly logger: Logger;
}

/** A vendor creates a preorder campaign, in `DRAFT` (SDD §14.2). */
export class CreateCampaignUseCase {
  constructor(private readonly deps: CreateCampaignDeps) {}

  async execute(input: CreateCampaignInput): Promise<PreorderCampaign> {
    const {
      campaignRepository,
      productVariantRepository,
      transactionRunner,
      auditWriter,
      idGenerator,
      clock,
      logger,
    } = this.deps;

    const variant = await productVariantRepository.findById(input.variantId);
    if (!variant || variant.vendorId !== input.vendorId) {
      throw new VariantNotEligibleForCampaignError();
    }

    const now = clock.now();
    const campaign = PreorderCampaign.draft({
      id: toCampaignId(idGenerator.generate()),
      vendorId: input.vendorId,
      variantId: input.variantId,
      opensAt: input.opensAt,
      orderCutoffAt: input.orderCutoffAt,
      fulfilmentWindowStart: input.fulfilmentWindowStart,
      fulfilmentWindowEnd: input.fulfilmentWindowEnd,
      totalQuantity: input.totalQuantity,
      advancePercent: input.advancePercent,
      maxPerCustomer: input.maxPerCustomer,
      fulfilmentMode: CampaignFulfilmentMode.fromName(input.fulfilmentMode),
      now,
    });

    return transactionRunner.run(async (scope) => {
      await campaignRepository.withTransaction(scope).create(campaign);

      await auditWriter.withTransaction(scope).record({
        actorId: input.principal.userId,
        actorRole: input.principal.role,
        action: PREORDER_AUDIT_ACTIONS.CAMPAIGN_CREATED,
        entityType: PREORDER_AUDIT_ENTITY_TYPES.CAMPAIGN,
        entityId: toUuid(campaign.id),
        after: {
          variantId: campaign.variantId,
          totalQuantity: campaign.totalQuantity,
          status: campaign.status.name,
        },
      });

      logger.info(
        { campaignId: campaign.id, vendorId: input.vendorId },
        'Preorder campaign created',
      );
      return campaign;
    });
  }
}
