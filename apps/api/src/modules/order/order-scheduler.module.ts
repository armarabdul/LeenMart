import type { PrismaClient } from '@prisma/client';
import type { Clock, IdGenerator, Logger } from '@leen-mart/domain-kit';
import type { ScheduledJob } from '../../shared/application/ports/scheduled-job.port.js';
import { PrismaOutboxWriter } from '../../shared/infrastructure/persistence/prisma-outbox-writer.js';
import { PrismaPickupReminderCandidateQuery } from './infrastructure/persistence/prisma-pickup-reminder-query.js';
import { PrismaPickupReminderOutboxLookup } from './infrastructure/persistence/prisma-pickup-reminder-outbox-lookup.js';
import { SendPickupRemindersUseCase } from './application/use-cases/send-pickup-reminders.use-case.js';

/**
 * S7-SCHED's own composition root — a separate file and separate exported
 * function from `createOrderModule`, mirroring `order-stream.module.ts`'s
 * own reasoning exactly: this builds worker-only pieces (a `ScheduledJob`,
 * never a router), so it has no place in the API-process composition root.
 */
export interface OrderSchedulerWorkerModuleDeps {
  /** `leenmart_checkout` — the cross-vendor sweep read (`PrismaPickupReminderCandidateQuery`'s own doc comment). */
  readonly checkoutPrisma: PrismaClient;
  /** `leenmart_app` — the idempotency check and the outbox write, both against `outbox_events`, which only this credential already has full CRUD on (see `PrismaPickupReminderOutboxLookup`'s own doc comment; no grant was widened to get this). */
  readonly prisma: PrismaClient;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
  readonly logger: Logger;
}

export interface OrderSchedulerWorkerModule {
  /** Registered with the scheduler platform's `ScheduledJobRegistry`. */
  readonly pickupReminderJob: ScheduledJob;
}

export const createOrderSchedulerWorkerModule = (
  deps: OrderSchedulerWorkerModuleDeps,
): OrderSchedulerWorkerModule => ({
  pickupReminderJob: new SendPickupRemindersUseCase({
    pickupReminderQuery: new PrismaPickupReminderCandidateQuery(deps.checkoutPrisma),
    pickupReminderOutboxLookup: new PrismaPickupReminderOutboxLookup(deps.prisma),
    outboxWriter: new PrismaOutboxWriter(deps.prisma, deps.idGenerator, deps.clock),
    clock: deps.clock,
    logger: deps.logger,
  }),
});
