import type { Clock, Logger, TransactionRunner } from '@leen-mart/domain-kit';
import { toUuid } from '@leen-mart/domain-kit';
import type { AuditWriter } from '../../../audit/index.js';
import type { OutboxWriter } from '../../../../shared/application/ports/outbox-writer.port.js';
import type { Principal, VendorId } from '../../../identity/index.js';
import { PREORDER_AUDIT_ACTIONS, PREORDER_AUDIT_ENTITY_TYPES } from '../../domain/audit-actions.js';
import { PREORDER_OUTBOX_EVENTS } from '../../domain/outbox-events.js';
import { type PreorderCampaign } from '../../domain/entities/preorder-campaign.entity.js';
import { CampaignNotFoundError } from '../../domain/errors/preorder-errors.js';
import type { CampaignRepository } from '../../domain/repositories/campaign.repository.js';
import type { ReservationRepository } from '../../domain/repositories/reservation.repository.js';
import type { CampaignId } from '../../domain/value-objects/campaign-id.value-object.js';
import type { RedisCampaignQuotaGate } from '../../infrastructure/cache/redis-campaign-quota-gate.js';

export interface CancelCampaignInput {
  readonly principal: Principal;
  readonly vendorId: VendorId;
  readonly campaignId: CampaignId;
  readonly reason: string;
}

export interface CancelCampaignDeps {
  readonly campaignRepository: CampaignRepository;
  readonly reservationRepository: ReservationRepository;
  readonly quotaGate: RedisCampaignQuotaGate;
  readonly transactionRunner: TransactionRunner;
  readonly auditWriter: AuditWriter;
  readonly outboxWriter: OutboxWriter;
  readonly clock: Clock;
  readonly logger: Logger;
}

/**
 * A vendor cancels their own campaign (SDD §14.6). Cancels every still-live
 * (`PENDING`/`CONFIRMED`) reservation and releases their held quantity — and
 * stops there. **No refund call anywhere in this use case**: BR-06/07
 * remain unresolved (Phase Next's own explicit scope boundary), the same
 * boundary `CancelOrderUseCase` already establishes for ordinary orders.
 * §14.6's "full advance refunded automatically" is therefore *not*
 * implemented as literally stated — only the domain-state half (cancel +
 * release) is.
 */
export class CancelCampaignUseCase {
  constructor(private readonly deps: CancelCampaignDeps) {}

  async execute(input: CancelCampaignInput): Promise<PreorderCampaign> {
    const {
      campaignRepository,
      reservationRepository,
      quotaGate,
      transactionRunner,
      auditWriter,
      outboxWriter,
      clock,
      logger,
    } = this.deps;

    const cancelled = await transactionRunner.run(async (scope) => {
      const campaigns = campaignRepository.withTransaction(scope);
      const reservations = reservationRepository.withTransaction(scope);

      const existing = await campaigns.findByIdAndVendorId(input.campaignId, input.vendorId);
      if (!existing) throw new CampaignNotFoundError();

      const now = clock.now();
      const cancelled = existing.cancel(now);
      await campaigns.update(cancelled);

      // Cancel every still-live reservation and release its held quantity —
      // no refund, per this use case's own doc comment above.
      let page = await reservations.listByCampaignId({ campaignId: existing.id, limit: 100 });
      for (;;) {
        for (const reservation of page.items) {
          if (reservation.status.name !== 'PENDING' && reservation.status.name !== 'CONFIRMED')
            continue;
          // Already converted to a real order — the order's own cancel/return
          // flow governs from here, not this campaign-level sweep.
          if (reservation.convertedOrderId !== null) continue;
          const released = reservation.cancel(now);
          await reservations.update(released);
        }
        if (!page.hasMore || !page.nextCursor) break;
        page = await reservations.listByCampaignId({
          campaignId: existing.id,
          limit: 100,
          cursor: page.nextCursor,
        });
      }

      await auditWriter.withTransaction(scope).record({
        actorId: input.principal.userId,
        actorRole: input.principal.role,
        action: PREORDER_AUDIT_ACTIONS.CAMPAIGN_CANCELLED,
        entityType: PREORDER_AUDIT_ENTITY_TYPES.CAMPAIGN,
        entityId: toUuid(cancelled.id),
        reason: input.reason,
        before: { status: existing.status.name },
        after: { status: cancelled.status.name },
      });

      await outboxWriter.withTransaction(scope).write({
        aggregateType: PREORDER_AUDIT_ENTITY_TYPES.CAMPAIGN,
        aggregateId: toUuid(cancelled.id),
        eventType: PREORDER_OUTBOX_EVENTS.CANCELLED,
        payload: { campaignId: cancelled.id, vendorId: cancelled.vendorId },
      });

      return cancelled;
    });

    await quotaGate.clear(cancelled.id);
    logger.info({ campaignId: cancelled.id }, 'Preorder campaign cancelled');
    return cancelled;
  }
}
