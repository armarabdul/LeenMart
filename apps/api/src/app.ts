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
import { createCustomerModule } from './modules/customer/index.js';
import {
  createIdentityModule,
  type AccessTokenService,
  type SessionDenylist,
} from './modules/identity/index.js';
import { createVendorModule } from './modules/vendor/index.js';

/**
 * Response headers a cross-origin browser client is allowed to read.
 *
 * SDD 9.2 makes the rate-limit headers part of the API contract, so they have
 * to be listed here: an unexposed response header is invisible to `fetch`,
 * which would leave a browser client unable to back off on anything but a
 * bare 429. Both the `X-RateLimit-*` set SDD 9.2 names and draft-7's
 * `RateLimit` header are exposed, matching what the limiter actually sends.
 */
const EXPOSED_HEADERS = [
  'X-Request-Id',
  'X-RateLimit-Limit',
  'X-RateLimit-Remaining',
  'X-RateLimit-Reset',
  'RateLimit',
  'RateLimit-Policy',
  'Retry-After',
];

/**
 * Mounts every module beyond `identity` itself. Split out of `createApp`
 * purely to stay under this file's max-lines-per-function budget — each of
 * these modules shares identity's token verifier *and* its session denylist
 * rather than minting a second one (SDD 5), which is why both are threaded
 * through rather than each module constructing its own — a second denylist
 * instance would mean a session revoked at logout kept authenticating on
 * these routes (SDD 7.2).
 */
const mountBusinessModules = (
  app: Express,
  params: {
    prisma: Container['prisma'];
    env: Container['env'];
    accessTokenService: AccessTokenService;
    sessionDenylist: SessionDenylist;
    accessTokenTtlSeconds: number;
    clock: Container['clock'];
    idGenerator: Container['idGenerator'];
    logger: Container['logger'];
  },
): void => {
  const vendorModule = createVendorModule(params);
  app.use('/api/v1/vendors', vendorModule.router);

  const customerModule = createCustomerModule(params);
  app.use('/api/v1/me', customerModule.router);

  // Further business modules mount here as they are built, e.g.
  //   app.use('/api/v1/catalogue', createCatalogueRouter(container));
};

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
      exposedHeaders: EXPOSED_HEADERS,
      maxAge: 86_400,
    }),
  );

  app.use(compression());
  app.use(json({ limit: env.BODY_LIMIT }));
  app.use(urlencoded({ extended: false, limit: env.BODY_LIMIT }));

  app.use(createRateLimiter(redis, env));

  // --- routes ---
  app.use(createHealthRouter({ env, prisma, redis, clock }));

  const identityModule = createIdentityModule({ prisma, redis, env, clock, idGenerator, logger });
  app.use('/api/v1/identity', identityModule.router);
  app.use('/api/v1/admin', identityModule.adminAuthRouter);

  mountBusinessModules(app, {
    prisma,
    env,
    accessTokenService: identityModule.accessTokenService,
    sessionDenylist: identityModule.sessionDenylist,
    accessTokenTtlSeconds: env.JWT_ACCESS_TTL_SECONDS,
    clock,
    idGenerator,
    logger,
  });

  app.use(createNotFoundHandler(clock));
  app.use(createErrorHandler(rootLogger, clock));

  return app;
};
