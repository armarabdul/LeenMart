import { toUuid, type Clock, type Logger } from '@leen-mart/domain-kit';
import type { ScheduledJob } from '../../../../shared/application/ports/scheduled-job.port.js';
import type { OutboxWriter } from '../../../../shared/application/ports/outbox-writer.port.js';
import { PREORDER_AUDIT_ENTITY_TYPES } from '../../domain/audit-actions.js';
import { PREORDER_OUTBOX_EVENTS } from '../../domain/outbox-events.js';
import type { PreorderCampaign } from '../../domain/entities/preorder-campaign.entity.js';
import type { CampaignRepository } from '../../domain/repositories/campaign.repository.js';
import type { ReservationRepository } from '../../domain/repositories/reservation.repository.js';
import type { RedisCampaignQuotaGate } from '../../infrastructure/cache/redis-campaign-quota-gate.js';
import type { ConvertReservationToOrderUseCase } from './convert-reservation-to-order.use-case.js';

const BATCH_LIMIT = 200;
/** BullMQ `upsertJobScheduler({ every: intervalMs })` — a minute is generous headroom against the hour-plus windows these transitions key off (`opensAt`/`orderCutoffAt`/`fulfilmentWindowStart`), the same cadence order-scheduler's own sweep uses for its own coarser windows. */
export const CAMPAIGN_LIFECYCLE_TICK_INTERVAL_MS = 60_000;

export interface SweepCampaignLifecycleDeps {
  readonly campaignRepository: CampaignRepository;
  readonly reservationRepository: ReservationRepository;
  readonly quotaGate: RedisCampaignQuotaGate;
  readonly outboxWriter: OutboxWriter;
  /** Reused, never forked — the same class this campaign's confirmed, balance-paid reservations are handed to the moment fulfilment begins. */
  readonly convertReservationToOrderUseCase: ConvertReservationToOrderUseCase;
  readonly clock: Clock;
  readonly logger: Logger;
}

/**
 * SDD §14.2's own lifecycle, driven forward by time and by remaining
 * quantity rather than any client request — the "reconciling cron sweep"
 * the SDD's own narrative already calls for as the correctness backstop.
 *
 * Handles `DRAFT -> SCHEDULED -> OPEN -> {SOLD_OUT | CLOSED} -> FULFILLING`,
 * and — the moment a campaign reaches `FULFILLING` — resolves every one of
 * its `CONFIRMED` reservations in the same tick:
 *
 *   - Balance already paid: converted into a real order
 *     (`ConvertReservationToOrderUseCase`).
 *   - Balance never paid: auto-cancelled, quantity released, no refund
 *     call — SDD §14.6's own "balance unpaid at window open -> auto-cancel"
 *     narrative, and the same BR-06/07 no-refund boundary every other
 *     cancellation path in this module already keeps.
 *
 * **`FULFILLING -> {COMPLETED | PARTIALLY_FULFILLED}` is deliberately not
 * implemented here** — the brief's own state machine names both as the
 * eventual destination but defines no rule for choosing between them, and
 * inventing one (e.g. "some fraction of reservations never converted") would
 * mean silently resolving an undocumented business decision, exactly what
 * the brief's own instruction forbids. A campaign that reaches `FULFILLING`
 * stays there until a later, explicitly-scoped milestone adds that rule.
 *
 * Every step here is a plain, unconditional write — never called
 * concurrently with itself (`AdvisoryLock`, the scheduler platform's own
 * guarantee), and each transition's `from` set in `PreorderCampaign`'s own
 * `TRANSITIONS` table means a row already moved by a previous tick simply
 * will not match the next tick's query, which is what makes running twice
 * in a row (a missed-tick catch-up) safe without any idempotency key of its
 * own.
 */
export class SweepCampaignLifecycleUseCase implements ScheduledJob {
  readonly name = 'preorder-campaign-lifecycle';
  readonly intervalMs = CAMPAIGN_LIFECYCLE_TICK_INTERVAL_MS;

  constructor(private readonly deps: SweepCampaignLifecycleDeps) {}

  async run(): Promise<void> {
    const now = this.deps.clock.now();
    const scheduled = await this.sweepDraftToScheduled(now);
    const opened = await this.sweepScheduledToOpen(now);
    const soldOut = await this.sweepOpenToSoldOut(now);
    const closed = await this.sweepOpenToClosed(now);
    const fulfilling = await this.sweepToFulfilling(now);

    if (scheduled + opened + soldOut + closed + fulfilling > 0) {
      this.deps.logger.info(
        { scheduled, opened, soldOut, closed, fulfilling },
        'Preorder campaign lifecycle sweep complete',
      );
    }
  }

  private async sweepDraftToScheduled(now: Date): Promise<number> {
    const { campaignRepository } = this.deps;
    const drafts = await campaignRepository.listDraft(BATCH_LIMIT);
    for (const campaign of drafts) {
      await campaignRepository.update(campaign.schedule(now));
    }
    return drafts.length;
  }

  private async sweepScheduledToOpen(now: Date): Promise<number> {
    const { campaignRepository, quotaGate, outboxWriter } = this.deps;
    const due = await campaignRepository.listByStatusDue('SCHEDULED', 'opensAt', now, BATCH_LIMIT);
    for (const campaign of due) {
      const opened = campaign.open(now);
      await campaignRepository.update(opened);
      // Layer 1's own initialisation point — `RedisCampaignQuotaGate`'s own
      // doc comment names this exact moment ("called when a campaign
      // transitions to OPEN").
      await quotaGate.setRemaining(opened.id, opened.remainingQuantity);
      await outboxWriter.write({
        aggregateType: PREORDER_AUDIT_ENTITY_TYPES.CAMPAIGN,
        aggregateId: toUuid(opened.id),
        eventType: PREORDER_OUTBOX_EVENTS.OPENED,
        payload: { campaignId: opened.id, vendorId: opened.vendorId },
      });
    }
    return due.length;
  }

  private async sweepOpenToSoldOut(now: Date): Promise<number> {
    const { campaignRepository, outboxWriter } = this.deps;
    const candidates = await campaignRepository.listSoldOutCandidates(BATCH_LIMIT);
    for (const campaign of candidates) {
      const soldOut = campaign.markSoldOut(now);
      await campaignRepository.update(soldOut);
      await outboxWriter.write({
        aggregateType: PREORDER_AUDIT_ENTITY_TYPES.CAMPAIGN,
        aggregateId: toUuid(soldOut.id),
        eventType: PREORDER_OUTBOX_EVENTS.SOLD_OUT,
        payload: { campaignId: soldOut.id, vendorId: soldOut.vendorId },
      });
    }
    return candidates.length;
  }

  private async sweepOpenToClosed(now: Date): Promise<number> {
    const { campaignRepository, quotaGate, outboxWriter } = this.deps;
    const due = await campaignRepository.listByStatusDue('OPEN', 'orderCutoffAt', now, BATCH_LIMIT);
    for (const campaign of due) {
      const closed = campaign.close(now);
      await campaignRepository.update(closed);
      // The gate's own key stops mattering once the campaign no longer
      // accepts reservations — cleared rather than left to expire on its
      // own TTL, the same reasoning `CancelCampaignUseCase` already applies.
      await quotaGate.clear(closed.id);
      await outboxWriter.write({
        aggregateType: PREORDER_AUDIT_ENTITY_TYPES.CAMPAIGN,
        aggregateId: toUuid(closed.id),
        eventType: PREORDER_OUTBOX_EVENTS.CLOSED,
        payload: { campaignId: closed.id, vendorId: closed.vendorId },
      });
    }
    return due.length;
  }

  private async sweepToFulfilling(now: Date): Promise<number> {
    const { campaignRepository } = this.deps;
    const fromSoldOut = await campaignRepository.listByStatusDue(
      'SOLD_OUT',
      'fulfilmentWindowStart',
      now,
      BATCH_LIMIT,
    );
    const fromClosed = await campaignRepository.listByStatusDue(
      'CLOSED',
      'fulfilmentWindowStart',
      now,
      BATCH_LIMIT,
    );
    for (const campaign of [...fromSoldOut, ...fromClosed]) {
      const fulfilling = campaign.startFulfilling(now);
      await campaignRepository.update(fulfilling);
      await this.resolveFulfillingReservations(fulfilling, now);
    }
    return fromSoldOut.length + fromClosed.length;
  }

  /**
   * Every `CONFIRMED` reservation against one just-`FULFILLING` campaign,
   * resolved once — converted if its balance is paid, auto-cancelled
   * otherwise. Each reservation's own failure is caught and logged rather
   * than aborting the batch: a single bad row (a deleted address, an
   * unpublished product) must not block every other customer's reservation
   * in the same campaign from resolving, and — since neither outcome here
   * changes the reservation's eligibility for the *next* tick to retry it —
   * running this again on a missed-tick catch-up is safe by construction.
   */
  private async resolveFulfillingReservations(
    campaign: PreorderCampaign,
    now: Date,
  ): Promise<void> {
    const { reservationRepository, campaignRepository, quotaGate, outboxWriter, logger } =
      this.deps;

    let page = await reservationRepository.listByCampaignId({
      campaignId: campaign.id,
      limit: 100,
    });
    for (;;) {
      for (const reservation of page.items) {
        if (reservation.status.name !== 'CONFIRMED') continue;
        if (reservation.convertedOrderId !== null) continue;

        if (reservation.balancePaidAt !== null) {
          try {
            await this.deps.convertReservationToOrderUseCase.execute(reservation.id);
          } catch (error) {
            logger.error(
              { err: error, reservationId: reservation.id, campaignId: campaign.id },
              'Failed to convert preorder reservation to an order at fulfilment time',
            );
          }
          continue;
        }

        const cancelled = reservation.cancel(now);
        const applied = await reservationRepository.updateIfStatus(cancelled, 'CONFIRMED');
        if (!applied) continue;

        await campaignRepository.incrementRemaining(campaign.id, reservation.quantity);
        await quotaGate.release(campaign.id, reservation.quantity).catch((error: unknown) => {
          logger.error(
            { err: error, campaignId: campaign.id },
            'Failed to release quota-gate compensation during fulfilment auto-cancel',
          );
        });
        await outboxWriter.write({
          aggregateType: PREORDER_AUDIT_ENTITY_TYPES.CAMPAIGN,
          aggregateId: toUuid(campaign.id),
          eventType: PREORDER_OUTBOX_EVENTS.RESERVATION_CANCELLED,
          payload: {
            campaignId: campaign.id,
            reservationId: reservation.id,
            customerId: reservation.customerId,
          },
        });
      }

      if (!page.hasMore || !page.nextCursor) break;
      page = await reservationRepository.listByCampaignId({
        campaignId: campaign.id,
        limit: 100,
        cursor: page.nextCursor,
      });
    }
  }
}
