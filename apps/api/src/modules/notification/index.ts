/**
 * In-app notifications (S6-NOTIFY-INAPP).
 *
 * `outbox_events` -> `OutboxRelay` -> this module's outbox handler -> the
 * BullMQ `notifications` queue -> `DeliverNotificationUseCase` -> the
 * `notifications` table -> `GET /api/v1/me/notifications`. The handler only
 * enqueues; every decision about who is notified is made in the orchestrator,
 * where a cross-vendor credential can resolve recipients without the event
 * payload having to carry them.
 *
 * Scope, deliberately: IN_APP only. No email, SMS, or Web Push; no preference
 * centre, quiet hours, templates, or localisation. SDD 11.2 names four
 * channels and this is the one with no external dependency.
 *
 * **Retention is one year** (SDD 22.5). No sweeper ships here — the table is
 * range-partitioned by month precisely so that enforcing it later is a
 * DETACH PARTITION rather than a bulk DELETE.
 */
// This module's single, intentional public surface. Code outside this module
// imports from here, not from the files beneath it (SDD 5.1).
export { createNotificationModule, createNotificationWorkerModule } from './notification.module.js';
export type {
  NotificationModule,
  NotificationModuleDeps,
  NotificationWorkerModule,
  NotificationWorkerModuleDeps,
} from './notification.module.js';
export { createNotificationWorker } from './infrastructure/jobs/notification-worker.js';
export {
  NOTIFICATION_QUEUE_NAME,
  NOTIFICATION_JOB_NAME,
  NOTIFICATION_JOB_ATTEMPTS,
  NOTIFICATION_BACKOFF_MS,
  NOTIFICATION_JOB_OPTIONS,
} from './infrastructure/jobs/notification-queue.js';
