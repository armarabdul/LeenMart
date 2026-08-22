import { toUuid, type Clock, type Logger } from '@leen-mart/domain-kit';
import type { ScheduledJob } from '../../../../shared/application/ports/scheduled-job.port.js';
import type { OutboxWriter } from '../../../../shared/application/ports/outbox-writer.port.js';
import { PREORDER_AUDIT_ENTITY_TYPES } from '../../domain/audit-actions.js';
import { PREORDER_OUTBOX_EVENTS } from '../../domain/outbox-events.js';
import type { CampaignRepository } from '../../domain/repositories/campaign.repository.js';
import type { ReservationRepository } from '../../domain/repositories/reservation.repository.js';
import type { RedisCampaignQuotaGate } from '../../infrastructure/cache/redis-campaign-quota-gate.js';

const BATCH_LIMIT = 200;
/** ASM-11's 10-minute TTL wants a much finer sweep granularity than the campaign lifecycle sweep's minute-scale windows — a slot held past its 10-minute expiry should be released within seconds of becoming eligible, not up to a full minute late. */
export const RESERVATION_EXPIRY_TICK_INTERVAL_MS = 15_000;

export interface SweepReservationExpiryDeps {
  readonly reservationRepository: ReservationRepository;
  readonly campaignRepository: CampaignRepository;
  readonly quotaGate: RedisCampaignQuotaGate;
  readonly outboxWriter: OutboxWriter;
  readonly clock: Clock;
  readonly logger: Logger;
}

/**
 * ASM-11's 10-minute soft-reservation TTL, enforced. Every `PENDING`
 * reservation past its `expiresAt` is released: `PENDING -> EXPIRED`,
 * Postgres quantity restored, Redis's fast counter restored to match.
 *
 * **`updateIfStatus(expired, 'PENDING')` is the whole of this job's
 * protection against every race the brief names** — the exact "only the
 * current owner of the transition can perform the release" guard
 * `create-reservation.use-case.ts`'s own doc comment establishes:
 *
 *   - Expiry racing a customer's own confirm: if
 *     `ConfirmReservationPaymentUseCase` already moved the row to
 *     `CONFIRMED` between this job's read and write, the guard returns
 *     `false` and this job skips the release entirely — the row is no
 *     longer `PENDING`, so there is nothing to expire.
 *   - Duplicate expiry execution (a missed tick's catch-up, or the same
 *     tick re-reading a row it already expired): the second attempt's guard
 *     also returns `false`, because the first attempt already moved the row
 *     off `PENDING`.
 *   - Worker/HTTP retry of either side: same mechanism, same result — the
 *     guard is what makes this job idempotent, not a separate dedup key.
 */
export class SweepReservationExpiryUseCase implements ScheduledJob {
  readonly name = 'preorder-reservation-expiry';
  readonly intervalMs = RESERVATION_EXPIRY_TICK_INTERVAL_MS;

  constructor(private readonly deps: SweepReservationExpiryDeps) {}

  async run(): Promise<void> {
    const { reservationRepository, campaignRepository, quotaGate, outboxWriter, clock, logger } =
      this.deps;
    const now = clock.now();

    const candidates = await reservationRepository.listExpiredPending(now, BATCH_LIMIT);
    let released = 0;
    let lostRace = 0;

    for (const reservation of candidates) {
      const expired = reservation.expire(now);
      const applied = await reservationRepository.updateIfStatus(expired, 'PENDING');
      if (!applied) {
        lostRace += 1;
        continue;
      }

      await campaignRepository.incrementRemaining(reservation.campaignId, reservation.quantity);
      await quotaGate
        .release(reservation.campaignId, reservation.quantity)
        .catch((error: unknown) => {
          logger.error(
            { err: error, campaignId: reservation.campaignId },
            'Failed to release quota-gate compensation during expiry sweep',
          );
        });
      await outboxWriter.write({
        aggregateType: PREORDER_AUDIT_ENTITY_TYPES.CAMPAIGN,
        aggregateId: toUuid(reservation.campaignId),
        eventType: PREORDER_OUTBOX_EVENTS.RESERVATION_EXPIRED,
        payload: {
          campaignId: reservation.campaignId,
          reservationId: reservation.id,
          customerId: reservation.customerId,
        },
      });
      released += 1;
    }

    if (released > 0 || lostRace > 0) {
      logger.info(
        { candidates: candidates.length, released, lostRace },
        'Preorder reservation expiry sweep complete',
      );
    }
  }
}
