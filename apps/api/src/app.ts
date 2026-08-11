import express, { type Express, json, urlencoded } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import compression from 'compression';
import type { Container } from './container.js';
import { requestContextMiddleware } from './shared/interface/http/middleware/request-context.js';
import { createHttpLogger } from './shared/interface/http/middleware/http-logger.js';
import { createRateLimiter } from './shared/interface/http/middleware/rate-limit.js';
import {
  createErrorHandler,
  createNotFoundHandler,
} from './shared/interface/http/middleware/error-handler.js';
import { createHealthRouter } from './shared/interface/http/routes/health.routes.js';
import { createIdentityModule } from './modules/identity/index.js';
import { createVendorModule } from './modules/vendor/index.js';

/**
 * Builds the Express application.
 *
 * Kept separate from `server.ts` so integration tests can exercise the full
 * middleware stack with Supertest without binding a port.
 *
 * Middleware order is load-bearing:
 *   1. request context   — every later line needs the correlation id
 *   2. http logger       — must see the whole request, including failures
 *   3. security headers  — before anything can produce a response
 *   4. body parsing      — with an explicit size cap
 *   5. rate limiting     — after parsing so the limiter can key on identity,
 *                          before routing so handlers are protected
 *   6. routes
 *   7. 404 handler
 *   8. error handler     — always last; Express identifies it by arity
 */
export const createApp = (container: Container): Express => {
  const { env, rootLogger, idGenerator, prisma, redis, clock, logger } = container;
  const app = express();

  // Behind an ALB/Cloudflare: trust exactly as many proxies as we actually run,
  // never `true`, which would let a client spoof its own IP for rate limiting.
  app.set('trust proxy', env.TRUST_PROXY);
  app.disable('x-powered-by');

  app.use(requestContextMiddleware(idGenerator));
  app.use(createHttpLogger(rootLogger));

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'"],
          imgSrc: ["'self'", 'data:', 'https:'],
          objectSrc: ["'none'"],
          frameAncestors: ["'none'"],
          baseUri: ["'self'"],
        },
      },
      hsts: { maxAge: 63_072_000, includeSubDomains: true, preload: true },
      referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
      crossOriginResourcePolicy: { policy: 'same-site' },
    }),
  );

  app.use(
    cors({
      origin: env.CORS_ALLOWED_ORIGINS,
      credentials: true,
      methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id', 'Idempotency-Key'],
      exposedHeaders: ['X-Request-Id', 'RateLimit', 'RateLimit-Policy', 'Retry-After'],
      maxAge: 86_400,
    }),
  );

  app.use(compression());
  app.use(json({ limit: env.BODY_LIMIT }));
  app.use(urlencoded({ extended: false, limit: env.BODY_LIMIT }));

  app.use(createRateLimiter(redis, env));

  // --- routes ---
  app.use(createHealthRouter({ env, prisma, redis, clock }));

  const identityModule = createIdentityModule({ prisma, env, clock, idGenerator, logger });
  app.use('/api/v1/identity', identityModule.router);
  app.use('/api/v1/admin', identityModule.adminAuthRouter);

  // Shares identity's token verifier rather than minting a second one (SDD 5).
  const vendorModule = createVendorModule({
    prisma,
    accessTokenService: identityModule.accessTokenService,
    clock,
    idGenerator,
    logger,
  });
  app.use('/api/v1/vendors', vendorModule.router);

  // Further business modules mount here as they are built, e.g.
  //   app.use('/api/v1/catalogue', createCatalogueRouter(container));

  app.use(createNotFoundHandler(clock));
  app.use(createErrorHandler(rootLogger, clock));

  return app;
};
