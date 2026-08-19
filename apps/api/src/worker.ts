import { type Container, createContainer } from './container.js';
import { createCatalogueMediaWorker } from './modules/catalogue/index.js';
import {
  createNotificationWorker,
  createNotificationWorkerModule,
} from './modules/notification/index.js';
import { createOutboxHandlerRegistry } from './shared/application/ports/outbox-handler.port.js';
import { OutboxRelay } from './shared/application/services/outbox-relay.js';
import { PrismaOutboxRelayStore } from './shared/infrastructure/persistence/prisma-outbox-relay-store.js';
import { createLoggingOutboxHandler } from './shared/infrastructure/jobs/logging-outbox-handler.js';
import {
  OUTBOX_POLL_INTERVAL_MS,
  startOutboxRelay,
  type OutboxRelayRunner,
} from './shared/infrastructure/jobs/outbox-relay-runner.js';

/**
 * The background worker process (S2-6b, SDD 12.2 step 5).
 *
 * **A separate process from `server.ts`, deliberately.** Media processing is
 * seconds of CPU-bound libvips work per upload; running it on the API's event
 * loop would stall request handling, and running it as an in-process
 * scheduler beside Express would tie worker capacity to HTTP replica count.
 * The two scale independently because they are two entry points over one
 * container.
 *
 * Shares `createContainer` with the API for exactly that reason: the database
 * credential, the Redis connections, the clock and the id generator are the
 * same objects configured the same way, so there is no second, drifting
 * definition of "how this service connects to anything". What differs is what
 * is built on top — no Express, no routers, no HTTP server.
 *
 * Shutdown mirrors `server.ts`'s: stop accepting new jobs, let in-flight ones
 * finish, then release connections. `worker.close()` is BullMQ's own drain —
 * it waits for active jobs rather than abandoning them, which is what keeps a
 * half-processed media item from being left in `PROCESSING` with no job to
 * resume it.
 */
let shuttingDown = false;

const startWorker = async (): Promise<void> => {
  const container = createContainer();
  const { env, rootLogger, prisma, checkoutPrisma, bullRedis, idGenerator, clock, logger } =
    container;

  const worker = createCatalogueMediaWorker({
    prisma,
    bullRedis,
    env,
    idGenerator,
    clock,
    logger,
  });

  await worker.waitUntilReady();

  // S5-OUTBOX. The relay lives beside the media worker rather than in its own
  // process: both are background work on the same container, and a second
  // process would double the deployment surface to run a one-second timer.
  // `outbox_events` is not tenant-scoped, so unlike the media worker this needs
  // no `runWithTenant` — there is no tenant to establish.
  // S6-NOTIFY-INAPP. The notification half is built here rather than beside the
  // API, because only the worker may write notifications: the handler that
  // reaches the relay can enqueue and nothing else, and the orchestrator that
  // can write sits behind the queue.
  const notifications = createNotificationWorkerModule({
    checkoutPrisma,
    bullRedis,
    idGenerator,
    clock,
    logger,
  });
  const notificationWorker = createNotificationWorker({
    connection: bullRedis,
    deliverNotificationUseCase: notifications.deliverNotificationUseCase,
    logger,
  });
  await notificationWorker.waitUntilReady();

  const relay = new OutboxRelay({
    store: new PrismaOutboxRelayStore(prisma, clock),
    // The logging handler stays: it is how an operator sees the relay working
    // for the six event types notifications deliberately ignore.
    registry: createOutboxHandlerRegistry([
      createLoggingOutboxHandler(logger),
      notifications.outboxHandler,
    ]),
    logger,
  });
  const relayRunner = startOutboxRelay(relay, logger);

  rootLogger.info(
    { env: env.NODE_ENV, version: env.APP_VERSION, queue: worker.name },
    'Leen Mart media worker started',
  );
  rootLogger.info({ intervalMs: OUTBOX_POLL_INTERVAL_MS }, 'Outbox relay started');
  rootLogger.info({ queue: notificationWorker.name }, 'Notification worker started');

  registerShutdownHandlers(
    { media: worker, notifications: notificationWorker, queue: notifications.queue },
    relayRunner,
    container,
  );
  registerCrashHandlers(container);
};

type MediaWorker = ReturnType<typeof createCatalogueMediaWorker>;
type NotificationWorker = ReturnType<typeof createNotificationWorker>;

/** Everything this process must drain, in one value rather than three parameters. */
interface Workers {
  readonly media: MediaWorker;
  readonly notifications: NotificationWorker;
  readonly queue: { close(): Promise<void> };
}

const registerShutdownHandlers = (
  workers: Workers,
  relayRunner: OutboxRelayRunner,
  container: Container,
): void => {
  const { env, rootLogger } = container;

  const shutdown = (signal: string): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    rootLogger.info({ signal }, 'Shutdown signal received, draining in-flight jobs');

    const forceExit = setTimeout(() => {
      rootLogger.error(
        { timeoutMs: env.SHUTDOWN_TIMEOUT_MS },
        'Graceful shutdown timed out, forcing exit',
      );
      process.exit(1);
    }, env.SHUTDOWN_TIMEOUT_MS);
    forceExit.unref();

    void (async (): Promise<void> => {
      try {
        // The relay stops first: it claims rows, and draining it before the
        // connections close is what keeps a shutdown from stranding a batch
        // mid-dispatch.
        // Order matters: the relay stops first so nothing new is enqueued,
        // then the queue's producer, then the consumers drain what is already
        // in flight, and only then are the connections released.
        await relayRunner.close();
        await workers.queue.close();
        await workers.media.close();
        await workers.notifications.close();
        await container.dispose();
        rootLogger.info({}, 'Shutdown complete');
        process.exit(0);
      } catch (error) {
        rootLogger.error({ err: error }, 'Error while shutting the worker down');
        process.exit(1);
      }
    })();
  };

  process.on('SIGTERM', () => {
    shutdown('SIGTERM');
  });
  process.on('SIGINT', () => {
    shutdown('SIGINT');
  });
};

const registerCrashHandlers = (container: Container): void => {
  const { rootLogger } = container;

  // Same reasoning as `server.ts`: an unhandled rejection leaves the process
  // in an unknown state, and a worker in an unknown state is one that may be
  // silently dropping jobs. Let the orchestrator replace it.
  process.on('unhandledRejection', (reason) => {
    rootLogger.fatal({ err: reason }, 'Unhandled promise rejection');
    process.exit(1);
  });

  process.on('uncaughtException', (error) => {
    rootLogger.fatal({ err: error }, 'Uncaught exception');
    process.exit(1);
  });
};

startWorker().catch((error: unknown) => {
  process.stderr.write(
    `Failed to start Leen Mart media worker: ${error instanceof Error ? error.stack : String(error)}\n`,
  );
  process.exit(1);
});
