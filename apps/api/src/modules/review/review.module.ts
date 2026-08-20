import type { PrismaClient } from '@prisma/client';
import type { Router } from 'express';
import type { Clock, IdGenerator, Logger } from '@leen-mart/domain-kit';
import { AmbientAuditWriter } from '../audit/index.js';
import { PrismaAuditLogRepository } from '../audit/infrastructure/persistence/prisma-audit-log.repository.js';
import type { AccessTokenService, SessionDenylist } from '../identity/index.js';
import { AdminTransactionRunner } from '../../shared/infrastructure/persistence/tenant-prisma.js';
import type { VendorTenantResolver } from '../../shared/interface/http/middleware/tenant-context.js';
import { CreateReviewUseCase } from './application/use-cases/create-review.use-case.js';
import { DecideReviewModerationUseCase } from './application/use-cases/decide-review-moderation.use-case.js';
import { ListMyReviewsUseCase } from './application/use-cases/list-my-reviews.use-case.js';
import { ListProductReviewsUseCase } from './application/use-cases/list-product-reviews.use-case.js';
import { ListReviewModerationQueueUseCase } from './application/use-cases/list-review-moderation-queue.use-case.js';
import { PrismaPublicReviewQuery } from './infrastructure/persistence/prisma-public-review-query.js';
import { PrismaReviewModerationRepository } from './infrastructure/persistence/prisma-review-moderation.repository.js';
import { PrismaReviewRepository } from './infrastructure/persistence/prisma-review.repository.js';
import { PrismaVerifiedPurchaseQuery } from './infrastructure/persistence/prisma-verified-purchase-query.js';
import { createAdminReviewController } from './interface/http/admin-review.controller.js';
import { createAdminReviewRouter } from './interface/http/admin-review.routes.js';
import { createPublicReviewController } from './interface/http/public-review.controller.js';
import { createPublicReviewRouter } from './interface/http/public-review.routes.js';
import { createReviewController } from './interface/http/review.controller.js';
import { createReviewRouter } from './interface/http/review.routes.js';

export interface ReviewModuleDeps {
  /** The ordinary app-tier credential — the customer's own review write/read (`reviews_customer_select`/`reviews_customer_insert`, 20260820180000; `Review` is in `TENANT_SCOPED_MODELS`/`USER_ROOTED_MODELS`, so this must be the `withTenantBoundary`-wrapped client, never a bare one). */
  readonly prisma: PrismaClient;
  /** The moderator credential (`reviews_admin_select`/`reviews_admin_update`). */
  readonly adminPrisma: PrismaClient;
  /** The unauthenticated public credential (`reviews_public_read`, approved-only). */
  readonly publicPrisma: PrismaClient;
  /** The cross-vendor, cross-customer read `PrismaVerifiedPurchaseQuery` needs to check a purchase's ownership and status — `leenmart_checkout`, the same credential `PrismaOrderRepository`/`PrismaPickupReminderCandidateQuery` already read orders on. */
  readonly checkoutPrisma: PrismaClient;
  readonly accessTokenService: AccessTokenService;
  readonly sessionDenylist: SessionDenylist;
  /** Sets `app.user_id` on `/me/reviews` — see `review.routes.ts`'s own comment on why a customer-only route still needs this. */
  readonly resolveVendorTenant: VendorTenantResolver;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
  readonly logger: Logger;
}

export interface ReviewModule {
  /** Mounted at `/api/v1/me`. */
  readonly router: Router;
  /** Mounted at `/api/v1/catalogue`. */
  readonly publicRouter: Router;
  /** Mounted at `/api/v1/admin/reviews`. */
  readonly adminRouter: Router;
}

/** Each adapter on the one credential its own surface is entitled to — split out for the function-length budget. */
const buildPersistence = (params: {
  prisma: ReviewModuleDeps['prisma'];
  adminPrisma: ReviewModuleDeps['adminPrisma'];
  publicPrisma: ReviewModuleDeps['publicPrisma'];
  checkoutPrisma: ReviewModuleDeps['checkoutPrisma'];
}): {
  reviewRepository: PrismaReviewRepository;
  verifiedPurchaseQuery: PrismaVerifiedPurchaseQuery;
  reviewModerationRepository: PrismaReviewModerationRepository;
  publicReviewQuery: PrismaPublicReviewQuery;
} => ({
  reviewRepository: new PrismaReviewRepository(params.prisma),
  verifiedPurchaseQuery: new PrismaVerifiedPurchaseQuery(params.checkoutPrisma),
  reviewModerationRepository: new PrismaReviewModerationRepository(params.adminPrisma),
  publicReviewQuery: new PrismaPublicReviewQuery(params.publicPrisma),
});

/**
 * The three use cases that need no admin credential, split out purely to keep
 * `createReviewModule` under this file's function-length budget — the same
 * reason every other module here splits its own builders.
 */
const buildCustomerAndPublicUseCases = (params: {
  verifiedPurchaseQuery: PrismaVerifiedPurchaseQuery;
  reviewRepository: PrismaReviewRepository;
  publicReviewQuery: PrismaPublicReviewQuery;
  idGenerator: ReviewModuleDeps['idGenerator'];
  clock: ReviewModuleDeps['clock'];
  logger: ReviewModuleDeps['logger'];
}): {
  createReviewUseCase: CreateReviewUseCase;
  listMyReviewsUseCase: ListMyReviewsUseCase;
  listProductReviewsUseCase: ListProductReviewsUseCase;
} => ({
  createReviewUseCase: new CreateReviewUseCase({
    verifiedPurchaseQuery: params.verifiedPurchaseQuery,
    reviewRepository: params.reviewRepository,
    idGenerator: params.idGenerator,
    clock: params.clock,
    logger: params.logger,
  }),
  listMyReviewsUseCase: new ListMyReviewsUseCase({ reviewRepository: params.reviewRepository }),
  listProductReviewsUseCase: new ListProductReviewsUseCase({
    publicReviewQuery: params.publicReviewQuery,
  }),
});

/**
 * The review module's composition root (S8-REVIEWS, SDD 5 module #14 V1
 * slice). Three routers, one module, mirroring `catalogue.module.ts`'s own
 * shape for a bounded context with a customer surface, a public surface and
 * an admin surface at once.
 */
export const createReviewModule = (deps: ReviewModuleDeps): ReviewModule => {
  const {
    prisma,
    adminPrisma,
    publicPrisma,
    checkoutPrisma,
    accessTokenService,
    sessionDenylist,
    resolveVendorTenant,
    idGenerator,
    clock,
    logger,
  } = deps;

  const { reviewRepository, verifiedPurchaseQuery, reviewModerationRepository, publicReviewQuery } =
    buildPersistence({ prisma, adminPrisma, publicPrisma, checkoutPrisma });
  // Built on `adminPrisma`, the same client `AdminTransactionRunner` below
  // opens its transaction on, so a moderation decision's audit write joins
  // the very transaction the status change is in — mirrors
  // `catalogue.module.ts`'s own admin-surface construction exactly.
  const auditWriter = new AmbientAuditWriter({
    auditLogRepository: new PrismaAuditLogRepository(adminPrisma),
    idGenerator,
    clock,
  });

  const { createReviewUseCase, listMyReviewsUseCase, listProductReviewsUseCase } =
    buildCustomerAndPublicUseCases({
      verifiedPurchaseQuery,
      reviewRepository,
      publicReviewQuery,
      idGenerator,
      clock,
      logger,
    });
  const listReviewModerationQueueUseCase = new ListReviewModerationQueueUseCase({
    reviewModerationRepository,
    logger,
  });
  const decideReviewModerationUseCase = new DecideReviewModerationUseCase({
    reviewModerationRepository,
    transactionRunner: new AdminTransactionRunner(adminPrisma),
    auditWriter,
    clock,
    logger,
  });

  const router = createReviewRouter(
    createReviewController({ createReviewUseCase, listMyReviewsUseCase }),
    accessTokenService,
    sessionDenylist,
    resolveVendorTenant,
  );
  const publicRouter = createPublicReviewRouter(
    createPublicReviewController({ listProductReviewsUseCase }),
  );
  const adminRouter = createAdminReviewRouter(
    createAdminReviewController({
      listReviewModerationQueueUseCase,
      decideReviewModerationUseCase,
    }),
    accessTokenService,
    sessionDenylist,
  );

  return { router, publicRouter, adminRouter };
};
