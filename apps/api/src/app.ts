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
import type { VendorTenantResolver } from './shared/interface/http/middleware/tenant-context.js';
import { createCartModule } from './modules/cart/index.js';
import { createNotificationModule } from './modules/notification/index.js';
import { createCatalogueModule } from './modules/catalogue/index.js';
import { createCustomerModule } from './modules/customer/index.js';
import { createLedgerModule } from './modules/ledger/index.js';
import { createOrderModule, createOrderStreamModule } from './modules/order/index.js';
import { createReviewModule } from './modules/review/index.js';
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
 * The vendor real-time order-alert surface (S4-SSE, FR-64, SDD §11.5) — its
 * own top-level mount, not nested under `/vendor/orders`, since it is a
 * long-lived SSE connection, not a request/response resource. Split out of
 * `mountBusinessModules` purely to keep that function under this file's
 * max-lines-per-function budget, the same reason `applySecurityMiddleware`
 * was. `vendorModule.resolveVendorTenant` is the one resolver every
 * vendor-facing router already receives (D-1) — nothing new crosses here.
 */
const mountOrderStreamRouter = (
  app: Express,
  params: {
    accessTokenService: AccessTokenService;
    sessionDenylist: SessionDenylist;
    pubSubRedis: Container['pubSubRedis'];
    logger: Container['logger'];
  },
  resolveVendorTenant: VendorTenantResolver,
): void => {
  const orderStreamModule = createOrderStreamModule({
    accessTokenService: params.accessTokenService,
    sessionDenylist: params.sessionDenylist,
    resolveVendorTenant,
    pubSubRedis: params.pubSubRedis,
    logger: params.logger,
  });
  app.use('/api/v1/vendor/stream', orderStreamModule.router);
};

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
    adminPrisma: Container['adminPrisma'];
    publicPrisma: Container['publicPrisma'];
    checkoutPrisma: Container['checkoutPrisma'];
    env: Container['env'];
    bullRedis: Container['bullRedis'];
    pubSubRedis: Container['pubSubRedis'];
    redis: Container['redis'];
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
  // The admin review surface (SDD 9.4), separate from the vendor-facing
  // router: it reads across tenants on the elevated credential and never
  // establishes a tenant context.
  app.use('/api/v1/admin/kyc', vendorModule.adminKycRouter);
  // The admin review surface (SDD 9.4), mounted apart from the vendor-facing
  // router: it establishes no tenant context and reads on the elevated
  // credential.
  app.use('/api/v1/admin/kyc', vendorModule.adminKycRouter);

  const customerModule = createCustomerModule(params);
  app.use('/api/v1/me', customerModule.router);

  // The cart surface (SDD 5 module 6 / S3-1): customer-owned, mounted at the
  // same `/api/v1/me` prefix as `addresses` — no tenant context, same as
  // `customerModule` above.
  const cartModule = createCartModule(params);
  app.use('/api/v1/me', cartModule.router);

  // The in-app notification surface (S6-NOTIFY-INAPP, SDD 11): the same
  // `/api/v1/me` prefix, and one route family for both audiences — a vendor
  // owner is a `users` row that also sells, so the portal and the PWA differ
  // only by the `kind` they ask for. Unlike its neighbours this one *does*
  // establish a tenant context: `notifications` is RLS-scoped by
  // `app.user_id`, which `tenantContext` is what sets.
  const notificationModule = createNotificationModule({
    prisma: params.prisma,
    accessTokenService: params.accessTokenService,
    sessionDenylist: params.sessionDenylist,
    resolveVendorTenant: vendorModule.resolveVendorTenant,
    clock: params.clock,
  });
  app.use('/api/v1/me', notificationModule.router);

  // The taxonomy admin surface (SDD 9.4). No tenant context: categories are
  // platform-owned and carry no vendor column for one to scope.
  const catalogueModule = createCatalogueModule({
    ...params,
    // D-1: the resolver, and nothing else, crosses from `vendor` to
    // `catalogue`. Handed over here in the composition root so neither module
    // imports the other (SDD 5.1).
    resolveVendorTenant: vendorModule.resolveVendorTenant,
  });
  app.use('/api/v1/admin/categories', catalogueModule.adminCategoryRouter);
  // The public catalogue surface (SDD 9.4/9.5, S2-2c): unauthenticated, no
  // tenant context, cache-friendly reads of the same platform-owned taxonomy.
  app.use('/api/v1/catalogue', catalogueModule.publicCategoryRouter);
  // The public product-detail surface (SDD 9.4, S3-3 discovery milestone):
  // unauthenticated, same `/api/v1/catalogue` prefix as the router above but
  // reading tenant-scoped tables on `publicPrisma` instead — RLS is what
  // makes that safe (see `catalogue.module.ts`).
  app.use('/api/v1/catalogue', catalogueModule.publicProductRouter);
  // The vendor-facing catalogue surface (SDD 9.4, S2-3b/S2-5): authenticated
  // and tenant-scoped, unlike the three routers around it.
  app.use('/api/v1/vendor/products', catalogueModule.vendorProductRouter);
  // The admin product moderation surface (SDD 9.4, S2-5): cross-tenant on the
  // elevated credential, no tenant context — mirrors adminKycRouter above.
  app.use('/api/v1/admin/products', catalogueModule.adminProductRouter);
  // The public search surface (SDD 9.4/9.5, S2-7): a standalone path, sibling
  // to `/api/v1/catalogue/*` rather than nested under it, auth optional.
  app.use('/api/v1/search', catalogueModule.publicSearchRouter);

  // The ledger module (SDD 10.3, S3-7; vendor read surface added S3-8).
  // Built once here, ahead of `orderModule`, so both its collaborators are
  // handed out from a single instance: the posting use case goes into
  // `orderModule` (the ledger's only writer-side caller), and its own
  // vendor-facing router is mounted directly below.
  const ledgerModule = createLedgerModule({
    ...params,
    resolveVendorTenant: vendorModule.resolveVendorTenant,
  });

  // The order surface (SDD 9.4, S3-3A): authenticated, customer-scoped,
  // reading/writing on the dedicated `leenmart_checkout` credential rather
  // than any tenant context — see `order.module.ts`'s own comment.
  const orderModule = createOrderModule({
    ...params,
    // D-1's own pattern, repeated here: the resolver, and nothing else,
    // crosses from `vendor` to `order` (SDD 5.1).
    resolveVendorTenant: vendorModule.resolveVendorTenant,
    postOrderPaymentJournalsUseCase: ledgerModule.postOrderPaymentJournalsUseCase,
  });
  app.use('/api/v1/orders', orderModule.router);
  // The vendor-facing order surface (SDD 9.4, S3-5): authenticated,
  // tenant-scoped on `leenmart_app`, mounted apart from the customer router
  // above — a distinct credential and a distinct resource shape (SubOrder,
  // not Order).
  app.use('/api/v1/vendor/orders', orderModule.vendorRouter);
  // The vendor earnings statement (SDD 10.3, S3-8): authenticated,
  // tenant-scoped on `leenmart_app`, read-only — a ledger-derived report, not
  // a payout or settlement surface.
  app.use('/api/v1/vendor/earnings', ledgerModule.vendorRouter);

  mountOrderStreamRouter(app, params, vendorModule.resolveVendorTenant);

  mountReviewModule(app, params, vendorModule.resolveVendorTenant);

  // Further business modules mount here as they are built.
};

/**
 * The review surface (SDD 5 module #14, S8-REVIEWS V1 slice) — a customer's
 * own reviews at the same `/api/v1/me` prefix as addresses/cart/
 * notifications, the public approved-only listing nested under
 * `/api/v1/catalogue/products/:productId` alongside the product-detail
 * surface, and the moderator queue at its own `/api/v1/admin/reviews`
 * prefix. Split out of `mountBusinessModules` purely to stay under this
 * file's max-lines-per-function budget, the same reason
 * `mountOrderStreamRouter` was.
 */
const mountReviewModule = (
  app: Express,
  params: {
    prisma: Container['prisma'];
    adminPrisma: Container['adminPrisma'];
    publicPrisma: Container['publicPrisma'];
    checkoutPrisma: Container['checkoutPrisma'];
    accessTokenService: AccessTokenService;
    sessionDenylist: SessionDenylist;
    idGenerator: Container['idGenerator'];
    clock: Container['clock'];
    logger: Container['logger'];
  },
  resolveVendorTenant: VendorTenantResolver,
): void => {
  const reviewModule = createReviewModule({ ...params, resolveVendorTenant });
  app.use('/api/v1/me', reviewModule.router);
  app.use('/api/v1/catalogue', reviewModule.publicRouter);
  app.use('/api/v1/admin/reviews', reviewModule.adminRouter);
};

/**
 * Security headers and CORS. Split out of `createApp` purely to stay under
 * this file's max-lines-per-function budget, the same reason
 * `mountBusinessModules` was.
 */
const applySecurityMiddleware = (app: Express, env: Container['env']): void => {
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
  const {
    env,
    rootLogger,
    idGenerator,
    prisma,
    adminPrisma,
    publicPrisma,
    checkoutPrisma,
    redis,
    bullRedis,
    pubSubRedis,
    clock,
    logger,
  } = container;
  const app = express();

  // Behind an ALB/Cloudflare: trust exactly as many proxies as we actually run,
  // never `true`, which would let a client spoof its own IP for rate limiting.
  app.set('trust proxy', env.TRUST_PROXY);
  app.disable('x-powered-by');

  app.use(requestContextMiddleware(idGenerator));
  app.use(createHttpLogger(rootLogger));

  applySecurityMiddleware(app, env);

  app.use(
    compression({
      // S4-SSE: gzip buffers and transforms writes, which works against an
      // SSE connection's "push each frame immediately" requirement. Excluded
      // by path — the smallest possible scoped change to this shared
      // middleware, falling back to the package's own default filter for
      // every other route.
      filter: (req, res) =>
        req.path === '/api/v1/vendor/stream' ? false : compression.filter(req, res),
    }),
  );
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
    adminPrisma,
    publicPrisma,
    checkoutPrisma,
    env,
    bullRedis,
    pubSubRedis,
    redis,
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
