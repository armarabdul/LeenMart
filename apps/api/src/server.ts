import { createServer, type Server } from 'node:http';
import { createApp } from './app.js';
import { type Container, createContainer } from './container.js';

/**
 * Process entry point: bootstrap, then graceful shutdown (SDD 20.5).
 *
 * The shutdown sequence matters. On SIGTERM we immediately fail readiness so
 * the load balancer stops routing, then drain in-flight requests, then release
 * connections. Skipping the readiness flip means the balancer keeps sending
 * traffic to a dying task for the length of its health-check interval.
 */
let shuttingDown = false;

const startServer = async (): Promise<void> => {
  const container = createContainer();
  const { env, rootLogger } = container;
  const app = createApp(container);
  const server = createServer(app);

  server.keepAliveTimeout = 65_000;
  server.headersTimeout = 66_000;

  await new Promise<void>((resolve) => {
    server.listen(env.PORT, env.HOST, resolve);
  });

  rootLogger.info(
    { port: env.PORT, host: env.HOST, env: env.NODE_ENV, version: env.APP_VERSION },
    'Leen Mart API listening',
  );

  registerShutdownHandlers(server, container);
  registerCrashHandlers(container);
};

const registerShutdownHandlers = (server: Server, container: Container): void => {
  const { env, rootLogger } = container;

  const shutdown = (signal: string): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    rootLogger.info({ signal }, 'Shutdown signal received, draining connections');

    const forceExit = setTimeout(() => {
      rootLogger.error(
        { timeoutMs: env.SHUTDOWN_TIMEOUT_MS },
        'Graceful shutdown timed out, forcing exit',
      );
      process.exit(1);
    }, env.SHUTDOWN_TIMEOUT_MS);
    forceExit.unref();

    server.close((error) => {
      void (async (): Promise<void> => {
        if (error) {
          rootLogger.error({ err: error }, 'Error while closing the HTTP server');
        }
        try {
          await container.dispose();
          rootLogger.info({}, 'Shutdown complete');
          process.exit(error ? 1 : 0);
        } catch (disposeError) {
          rootLogger.error({ err: disposeError }, 'Error while releasing resources');
          process.exit(1);
        }
      })();
    });
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

  // An unhandled rejection or uncaught exception leaves the process in an
  // unknown state. Log it, then let the orchestrator replace the task rather
  // than serving traffic from a corrupted runtime.
  process.on('unhandledRejection', (reason) => {
    rootLogger.fatal({ err: reason }, 'Unhandled promise rejection');
    process.exit(1);
  });

  process.on('uncaughtException', (error) => {
    rootLogger.fatal({ err: error }, 'Uncaught exception');
    process.exit(1);
  });
};

startServer().catch((error: unknown) => {
  // Bootstrap failed before a logger existed: stderr is all we have.
  process.stderr.write(
    `Failed to start Leen Mart API: ${error instanceof Error ? error.stack : String(error)}\n`,
  );
  process.exit(1);
});
