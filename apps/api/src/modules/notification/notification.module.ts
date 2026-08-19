import type { PrismaClient } from '@prisma/client';
import type { Router } from 'express';
import type { Clock, IdGenerator, Logger } from '@leen-mart/domain-kit';
import type { Redis } from 'ioredis';
import type { AccessTokenService, SessionDenylist } from '../identity/index.js';
import type { VendorTenantResolver } from '../../shared/interface/http/middleware/tenant-context.js';
import type { OutboxHandler } from '../../shared/application/ports/outbox-handler.port.js';
import { DeliverNotificationUseCase } from './application/use-cases/deliver-notification.use-case.js';
import {
  CountUnreadNotificationsUseCase,
  ListNotificationsUseCase,
  MarkAllNotificationsReadUseCase,
  MarkNotificationReadUseCase,
} from './application/use-cases/read-notifications.use-case.js';
import {
  PrismaNotificationReadRepository,
  PrismaNotificationWriteRepository,
} from './infrastructure/persistence/prisma-notification.repository.js';
import { PrismaNotificationRecipientResolver } from './infrastructure/persistence/prisma-notification-recipient-resolver.js';
import { BullMqNotificationQueue } from './infrastructure/jobs/notification-queue.js';
import { createNotificationOutboxHandler } from './infrastructure/jobs/notification-outbox-handler.js';
import { createNotificationController } from './interface/http/notification.controller.js';
import { createNotificationRouter } from './interface/http/notification.routes.js';

export interface NotificationModuleDeps {
  /**
   * The tenant-scoped client. Every read and read-state write goes through it,
   * so `notifications_recipient_select`/`_update` confine the caller to
   * `recipient_user_id = app.user_id`.
   */
  readonly prisma: PrismaClient;
  readonly accessTokenService: AccessTokenService;
  readonly sessionDenylist: SessionDenylist;
  readonly resolveVendorTenant: VendorTenantResolver;
  readonly clock: Clock;
}

export interface NotificationModule {
  /** Mounted at `/api/v1/me`, beside `addresses` and `cart`. */
  readonly router: Router;
}

/**
 * The customer/vendor read surface (S6-NOTIFY-INAPP).
 *
 * Deliberately separate from the worker half below: the API only ever reads and
 * marks read, and giving it the writer's credential would be handing the
 * request path the ability to manufacture notifications.
 */
export const createNotificationModule = (deps: NotificationModuleDeps): NotificationModule => {
  const repository = new PrismaNotificationReadRepository(deps.prisma);
  const readDeps = { repository, clock: deps.clock };

  const controller = createNotificationController({
    listNotificationsUseCase: new ListNotificationsUseCase(readDeps),
    countUnreadNotificationsUseCase: new CountUnreadNotificationsUseCase(readDeps),
    markNotificationReadUseCase: new MarkNotificationReadUseCase(readDeps),
    markAllNotificationsReadUseCase: new MarkAllNotificationsReadUseCase(readDeps),
  });

  return {
    router: createNotificationRouter(
      controller,
      deps.accessTokenService,
      deps.sessionDenylist,
      deps.resolveVendorTenant,
    ),
  };
};

export interface NotificationWorkerModuleDeps {
  /**
   * `leenmart_checkout` — the credential with cross-vendor reach. The
   * orchestrator resolves an order's vendors and then writes rows for users it
   * is not acting as; `leenmart_app` could do neither without impersonating
   * each recipient in turn. Read-only for the lookup, INSERT for the write, and
   * nothing more (see the migration's own comment).
   */
  readonly checkoutPrisma: PrismaClient;
  /** The BullMQ-dedicated connection — never `container.redis`. */
  readonly bullRedis: Redis;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
  readonly logger: Logger;
}

export interface NotificationWorkerModule {
  /** Registered with the outbox relay. Enqueues and returns — see the handler's own comment. */
  readonly outboxHandler: OutboxHandler;
  readonly deliverNotificationUseCase: DeliverNotificationUseCase;
  readonly queue: BullMqNotificationQueue;
}

/**
 * The write half (S6-NOTIFY-INAPP), built in the worker process.
 *
 * Two objects come out of it, and the split is the architecture: the
 * `outboxHandler` goes to the relay and can only enqueue, while
 * `deliverNotificationUseCase` runs behind the queue and is the only thing that
 * touches the database. Nothing hands the relay a repository.
 */
export const createNotificationWorkerModule = (
  deps: NotificationWorkerModuleDeps,
): NotificationWorkerModule => {
  const queue = new BullMqNotificationQueue(deps.bullRedis);

  return {
    queue,
    outboxHandler: createNotificationOutboxHandler(queue, deps.logger),
    deliverNotificationUseCase: new DeliverNotificationUseCase({
      repository: new PrismaNotificationWriteRepository(
        deps.checkoutPrisma,
        deps.idGenerator,
        deps.clock,
      ),
      recipients: new PrismaNotificationRecipientResolver(deps.checkoutPrisma),
      logger: deps.logger,
    }),
  };
};
