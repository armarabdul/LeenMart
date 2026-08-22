import type { Clock, Logger, TransactionRunner } from '@leen-mart/domain-kit';
import type { Principal, VendorId } from '../../../identity/index.js';
import { type PreorderCampaign } from '../../domain/entities/preorder-campaign.entity.js';
import { CampaignNotFoundError } from '../../domain/errors/preorder-errors.js';
import type { CampaignRepository } from '../../domain/repositories/campaign.repository.js';
import type { CampaignId } from '../../domain/value-objects/campaign-id.value-object.js';
import { CampaignFulfilmentMode } from '../../domain/value-objects/campaign-fulfilment-mode.value-object.js';
import type { RedisCampaignQuotaGate } from '../../infrastructure/cache/redis-campaign-quota-gate.js';

export interface UpdateCampaignInput {
  readonly principal: Principal;
  readonly vendorId: VendorId;
  readonly campaignId: CampaignId;
  readonly opensAt?: Date;
  readonly orderCutoffAt?: Date;
  readonly fulfilmentWindowStart?: Date;
  readonly fulfilmentWindowEnd?: Date;
  readonly totalQuantity?: number;
  readonly advancePercent?: number;
  readonly maxPerCustomer?: number;
  readonly fulfilmentMode?: 'DELIVERY' | 'PICKUP' | 'BOTH';
}

export interface UpdateCampaignDeps {
  readonly campaignRepository: CampaignRepository;
  readonly transactionRunner: TransactionRunner;
  /** Kept in sync (`setRemaining`, never a delta) whenever an `OPEN` campaign's quantity changes — the same "PostgreSQL always wins" reasoning the reconciliation sweep applies, just triggered eagerly here rather than waiting for the next tick. */
  readonly quotaGate: RedisCampaignQuotaGate;
  readonly clock: Clock;
  readonly logger: Logger;
}

/**
 * A vendor edits their own campaign (SDD §14.6). The domain entity's own
 * `update()` enforces the freeze rule — once the first reservation has
 * confirmed, quantity may only increase and the cutoff/fulfilment window are
 * immovable; this use case supplies no rule of its own beyond ownership and
 * persistence.
 */
export class UpdateCampaignUseCase {
  constructor(private readonly deps: UpdateCampaignDeps) {}

  async execute(input: UpdateCampaignInput): Promise<PreorderCampaign> {
    const { campaignRepository, transactionRunner, quotaGate, clock, logger } = this.deps;

    const updated = await transactionRunner.run(async (scope) => {
      const repository = campaignRepository.withTransaction(scope);
      const existing = await repository.findByIdAndVendorId(input.campaignId, input.vendorId);
      if (!existing) throw new CampaignNotFoundError();

      const now = clock.now();
      const updated = existing.update(
        {
          ...(input.opensAt !== undefined ? { opensAt: input.opensAt } : {}),
          ...(input.orderCutoffAt !== undefined ? { orderCutoffAt: input.orderCutoffAt } : {}),
          ...(input.fulfilmentWindowStart !== undefined
            ? { fulfilmentWindowStart: input.fulfilmentWindowStart }
            : {}),
          ...(input.fulfilmentWindowEnd !== undefined
            ? { fulfilmentWindowEnd: input.fulfilmentWindowEnd }
            : {}),
          ...(input.totalQuantity !== undefined ? { totalQuantity: input.totalQuantity } : {}),
          ...(input.advancePercent !== undefined ? { advancePercent: input.advancePercent } : {}),
          ...(input.maxPerCustomer !== undefined ? { maxPerCustomer: input.maxPerCustomer } : {}),
          ...(input.fulfilmentMode !== undefined
            ? { fulfilmentMode: CampaignFulfilmentMode.fromName(input.fulfilmentMode) }
            : {}),
        },
        now,
      );

      await repository.update(updated);
      logger.info({ campaignId: updated.id }, 'Preorder campaign updated');
      return updated;
    });

    if (updated.status.name === 'OPEN') {
      await quotaGate.setRemaining(updated.id, updated.remainingQuantity);
    }

    return updated;
  }
}
