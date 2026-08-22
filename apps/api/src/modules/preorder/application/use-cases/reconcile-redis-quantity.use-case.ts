import type { Logger } from '@leen-mart/domain-kit';
import type { ScheduledJob } from '../../../../shared/application/ports/scheduled-job.port.js';
import type { CampaignRepository } from '../../domain/repositories/campaign.repository.js';
import type { RedisCampaignQuotaGate } from '../../infrastructure/cache/redis-campaign-quota-gate.js';

const BATCH_LIMIT = 500;
/** SDD §14.4 layer 3's own "reconciling cron sweep every ~30 seconds". */
export const REDIS_RECONCILIATION_TICK_INTERVAL_MS = 30_000;

export interface ReconcileRedisQuantityDeps {
  readonly campaignRepository: CampaignRepository;
  readonly quotaGate: RedisCampaignQuotaGate;
  readonly logger: Logger;
}

/**
 * SDD §14.4 layer 3: "PostgreSQL always wins." Every currently-`OPEN`
 * campaign's Redis counter is overwritten from Postgres's own
 * `remainingQuantity` — a plain `SET`, never a delta — which is what makes
 * this safe to run on any schedule, from any starting state, as many times
 * as it likes. Two things it corrects for on its own, with no other code
 * involved:
 *
 *   - **Drift**: a `CreateReservationUseCase` compensation that failed to
 *     reach Redis (a crashed process between the Postgres commit and the
 *     `quotaGate.release()` call, or a `SweepReservationExpiryUseCase`
 *     release that logged-and-swallowed a Redis error) leaves the gate
 *     short a slot nobody actually holds. The next tick here corrects it.
 *   - **Missing counters**: a campaign whose `OPEN` transition ran before
 *     Redis was reachable, or whose key expired past its 30-day TTL, has no
 *     counter at all (`tryReserve` returns `UNKNOWN`, which fails open —
 *     correct, but conservative). The next tick here creates one.
 *
 * **Not paginated across ticks** — `CampaignRepository.listOpen`'s own doc
 * comment names this a deliberate, documented scale boundary: at most 500
 * simultaneously-`OPEN` campaigns are reconciled per tick, which this
 * milestone accepts as the "smallest isolated implementation" rather than
 * building real cursor-based sweep pagination for a safety net that a
 * higher campaign count would still only make *slower to converge*, never
 * incorrect (every tick still narrows the drift; running dry does not undo
 * a previous tick's correction).
 *
 * `CancelCampaignUseCase`/`SweepCampaignLifecycleUseCase`'s own `close()`
 * step already `quotaGate.clear()` a campaign the moment it leaves `OPEN` —
 * this sweep never needs to reconcile a closed campaign "after the fact"
 * because nothing here can un-clear a key `CLOSE`/`CANCEL` already removed.
 */
export class ReconcileRedisQuantityUseCase implements ScheduledJob {
  readonly name = 'preorder-redis-reconciliation';
  readonly intervalMs = REDIS_RECONCILIATION_TICK_INTERVAL_MS;

  constructor(private readonly deps: ReconcileRedisQuantityDeps) {}

  async run(): Promise<void> {
    const { campaignRepository, quotaGate, logger } = this.deps;

    const open = await campaignRepository.listOpen(BATCH_LIMIT);
    for (const campaign of open) {
      await quotaGate.setRemaining(campaign.id, campaign.remainingQuantity);
    }

    if (open.length > 0) {
      logger.info({ reconciled: open.length }, 'Preorder Redis quota-gate reconciliation complete');
    }
  }
}
