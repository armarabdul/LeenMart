import type { PrismaClient } from '@prisma/client';
import type { Router } from 'express';
import type { Redis } from 'ioredis';
import type { Logger } from '@leen-mart/domain-kit';
import type { AccessTokenService, SessionDenylist } from '../identity/index.js';
import type { VendorTenantResolver } from '../../shared/interface/http/middleware/tenant-context.js';
import type { OutboxHandler } from '../../shared/application/ports/outbox-handler.port.js';
import { VendorStreamRegistry } from './infrastructure/realtime/vendor-stream-registry.js';
import {
  subscribeVendorStream,
  type VendorStreamSubscriber,
} from './infrastructure/realtime/redis-vendor-stream-subscriber.js';
import { PrismaOrderVendorResolver } from './infrastructure/persistence/prisma-order-vendor-resolver.js';
import { createVendorStreamOutboxHandler } from './infrastructure/jobs/vendor-stream-outbox-handler.js';
import { createVendorStreamController } from './interface/http/vendor-stream.controller.js';
import { createVendorStreamRouter } from './interface/http/vendor-stream.routes.js';

/**
 * S4-SSE's own composition root — deliberately a separate file and separate
 * exported functions from `createOrderModule`, not a change to it. The two
 * halves below mirror `notification.module.ts`'s exact API/worker split for
 * the identical reason: only the worker process runs `OutboxRelay`, only the
 * API process holds SSE connections, and each side gets exactly the
 * dependencies its process actually has (`worker.ts` never touches Express;
 * `server.ts` never touches the outbox relay).
 */
export interface OrderStreamModuleDeps {
  readonly accessTokenService: AccessTokenService;
  readonly sessionDenylist: SessionDenylist;
  readonly resolveVendorTenant: VendorTenantResolver;
  /** The dedicated subscriber connection (S4-SSE) — see `createPubSubRedisClient`'s own comment. */
  readonly pubSubRedis: Redis;
  readonly logger: Logger;
}

export interface OrderStreamModule {
  /** Mounted at `/api/v1/vendor/stream` — its own top-level mount. */
  readonly router: Router;
  /** Closes the subscription on shutdown. Never disconnects `pubSubRedis` itself — `container.dispose()` owns that. */
  readonly subscriber: VendorStreamSubscriber;
}

/**
 * The API-process half (S4-SSE): the registry, the SSE route, and the
 * subscriber that bridges messages from the worker process into this
 * process's own connections.
 */
export const createOrderStreamModule = (deps: OrderStreamModuleDeps): OrderStreamModule => {
  const registry = new VendorStreamRegistry();
  const controller = createVendorStreamController(registry);
  const router = createVendorStreamRouter(controller, {
    accessTokenService: deps.accessTokenService,
    sessionDenylist: deps.sessionDenylist,
    resolveVendorTenant: deps.resolveVendorTenant,
  });
  const subscriber = subscribeVendorStream(deps.pubSubRedis, registry, deps.logger);

  return { router, subscriber };
};

export interface OrderStreamWorkerModuleDeps {
  /** `leenmart_checkout` — the credential with cross-vendor reach `PrismaOrderVendorResolver` needs. */
  readonly checkoutPrisma: PrismaClient;
  /** The existing BullMQ-dedicated connection, reused for `PUBLISH` — verified directly to accept ordinary commands alongside a `Queue` built on it (locked decision N-3). Never a new connection. */
  readonly bullRedis: Redis;
  readonly logger: Logger;
}

export interface OrderStreamWorkerModule {
  /** Registered with the outbox relay, alongside `NotificationOutboxHandler` — neither knows the other exists. */
  readonly outboxHandler: OutboxHandler;
}

/** The worker-process half (S4-SSE): resolves an order's vendors and publishes the pub/sub signal. No database write of its own. */
export const createOrderStreamWorkerModule = (
  deps: OrderStreamWorkerModuleDeps,
): OrderStreamWorkerModule => ({
  outboxHandler: createVendorStreamOutboxHandler(
    deps.bullRedis,
    new PrismaOrderVendorResolver(deps.checkoutPrisma),
    deps.logger,
  ),
});
