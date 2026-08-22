import type { PrismaClient } from '@prisma/client';
import type { Redis } from 'ioredis';
import type { Router } from 'express';
import type { Clock, IdGenerator, Logger } from '@leen-mart/domain-kit';
import { AmbientAuditWriter, type AuditWriter } from '../audit/index.js';
import { PrismaAuditLogRepository } from '../audit/infrastructure/persistence/prisma-audit-log.repository.js';
import { PrismaAddressRepository } from '../customer/infrastructure/persistence/prisma-address.repository.js';
import { PrismaProductVariantRepository } from '../catalogue/infrastructure/persistence/prisma-product-variant.repository.js';
import type { AccessTokenService, SessionDenylist } from '../identity/index.js';
import {
  CheckoutTransactionRunner,
  PrismaTransactionRunner,
} from '../../shared/infrastructure/persistence/tenant-prisma.js';
import { IdempotencyKeyRepository } from '../../shared/infrastructure/persistence/idempotency-key.repository.js';
import { PrismaOutboxWriter } from '../../shared/infrastructure/persistence/prisma-outbox-writer.js';
import type { VendorTenantResolver } from '../../shared/interface/http/middleware/tenant-context.js';
import { PrismaCampaignRepository } from './infrastructure/persistence/prisma-campaign.repository.js';
import { PrismaReservationRepository } from './infrastructure/persistence/prisma-reservation.repository.js';
import { PrismaPaymentAttemptRepository } from './infrastructure/persistence/prisma-payment-attempt.repository.js';
import { RedisCampaignQuotaGate } from './infrastructure/cache/redis-campaign-quota-gate.js';
import { MockPreorderPaymentGateway } from './infrastructure/payment/mock-preorder-payment-gateway.js';
import { CreateCampaignUseCase } from './application/use-cases/create-campaign.use-case.js';
import { UpdateCampaignUseCase } from './application/use-cases/update-campaign.use-case.js';
import { CancelCampaignUseCase } from './application/use-cases/cancel-campaign.use-case.js';
import { GetCampaignUseCase } from './application/use-cases/get-campaign.use-case.js';
import { ListCampaignsUseCase } from './application/use-cases/list-campaigns.use-case.js';
import { GetCampaignDemandSummaryUseCase } from './application/use-cases/get-campaign-demand-summary.use-case.js';
import { GetPublicCampaignUseCase } from './application/use-cases/get-public-campaign.use-case.js';
import { ListPublicCampaignsUseCase } from './application/use-cases/list-public-campaigns.use-case.js';
import { CreateReservationUseCase } from './application/use-cases/create-reservation.use-case.js';
import { CancelReservationUseCase } from './application/use-cases/cancel-reservation.use-case.js';
import { GetReservationUseCase } from './application/use-cases/get-reservation.use-case.js';
import { ListMyReservationsUseCase } from './application/use-cases/list-my-reservations.use-case.js';
import { InitiateReservationPaymentUseCase } from './application/use-cases/initiate-reservation-payment.use-case.js';
import { ConfirmReservationPaymentUseCase } from './application/use-cases/confirm-reservation-payment.use-case.js';
import {
  createVendorCampaignController,
  type VendorCampaignController,
} from './interface/http/vendor-campaign.controller.js';
import { createVendorCampaignRouter } from './interface/http/vendor-campaign.routes.js';
import { createPublicCampaignController } from './interface/http/public-campaign.controller.js';
import { createPublicCampaignRouter } from './interface/http/public-campaign.routes.js';
import {
  createReservationController,
  type ReservationController,
} from './interface/http/reservation.controller.js';
import { createReservationRouter } from './interface/http/reservation.routes.js';

interface ReservationUseCases {
  readonly createReservationUseCase: CreateReservationUseCase;
  readonly reservationRepository: PrismaReservationRepository;
  readonly campaignRepository: PrismaCampaignRepository;
  readonly paymentAttemptRepository: PrismaPaymentAttemptRepository;
  readonly preorderPaymentGateway: MockPreorderPaymentGateway;
  readonly quotaGate: RedisCampaignQuotaGate;
  readonly outboxWriter: PrismaOutboxWriter;
  readonly transactionRunner: CheckoutTransactionRunner;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
  readonly moduleLogger: Logger;
}

const buildReservationControllerInstance = (u: ReservationUseCases): ReservationController =>
  createReservationController({
    createReservationUseCase: u.createReservationUseCase,
    getReservationUseCase: new GetReservationUseCase({
      reservationRepository: u.reservationRepository,
    }),
    listMyReservationsUseCase: new ListMyReservationsUseCase({
      reservationRepository: u.reservationRepository,
    }),
    cancelReservationUseCase: new CancelReservationUseCase({
      reservationRepository: u.reservationRepository,
      campaignRepository: u.campaignRepository,
      quotaGate: u.quotaGate,
      outboxWriter: u.outboxWriter,
      transactionRunner: u.transactionRunner,
      clock: u.clock,
      logger: u.moduleLogger,
    }),
    initiateReservationPaymentUseCase: new InitiateReservationPaymentUseCase({
      reservationRepository: u.reservationRepository,
      paymentAttemptRepository: u.paymentAttemptRepository,
      preorderPaymentGateway: u.preorderPaymentGateway,
      outboxWriter: u.outboxWriter,
      transactionRunner: u.transactionRunner,
      idGenerator: u.idGenerator,
      clock: u.clock,
      logger: u.moduleLogger,
    }),
    confirmReservationPaymentUseCase: new ConfirmReservationPaymentUseCase({
      reservationRepository: u.reservationRepository,
      campaignRepository: u.campaignRepository,
      paymentAttemptRepository: u.paymentAttemptRepository,
      preorderPaymentGateway: u.preorderPaymentGateway,
      quotaGate: u.quotaGate,
      outboxWriter: u.outboxWriter,
      transactionRunner: u.transactionRunner,
      clock: u.clock,
      logger: u.moduleLogger,
    }),
  });

export interface PreorderModuleDeps {
  /** The vendor-facing tenant-scoped client (`leenmart_app`) — campaign CRUD and the vendor's own demand-summary read. */
  readonly prisma: PrismaClient;
  /** `leenmart_public` — public campaign browse/detail, and the same `AddCartItemUseCase`-precedent variant-eligibility read `create-campaign`/`create-reservation` need. */
  readonly publicPrisma: PrismaClient;
  /** `leenmart_checkout` — every customer reservation/payment write, and the campaign quantity mutation that happens inside that same transaction (this migration's own grant, mirroring `orders`). */
  readonly checkoutPrisma: PrismaClient;
  readonly redis: Redis;
  readonly accessTokenService: AccessTokenService;
  readonly sessionDenylist: SessionDenylist;
  readonly resolveVendorTenant: VendorTenantResolver;
  readonly clock: Clock;
  readonly idGenerator: IdGenerator;
  readonly logger: Logger;
}

export interface PreorderModule {
  /** Mounted at `/api/v1/vendor/preorder-campaigns`. */
  readonly vendorRouter: Router;
  /** Mounted at `/api/v1/preorders`, unauthenticated. */
  readonly publicRouter: Router;
  /** Mounted at `/api/v1/preorder-reservations`. */
  readonly reservationRouter: Router;
  /**
   * Exposed for the scheduler composition root (`preorder-scheduler.module.ts`)
   * and for tests that need to exercise the concurrency-critical use case
   * directly, without an HTTP round trip — the same reason `OrderModule`
   * exposes its router rather than nothing at all, just one layer deeper.
   */
  readonly createReservationUseCase: CreateReservationUseCase;
  readonly quotaGate: RedisCampaignQuotaGate;
}

interface SharedCollaborators {
  readonly quotaGate: RedisCampaignQuotaGate;
  readonly preorderPaymentGateway: MockPreorderPaymentGateway;
  /** `publicPrisma`-bound — the same `AddCartItemUseCase` precedent, reused by both the vendor create-campaign flow and the customer create-reservation flow. */
  readonly eligibilityVariantRepository: PrismaProductVariantRepository;
}

const buildVendorCampaignController = (
  deps: PreorderModuleDeps,
  shared: SharedCollaborators,
): VendorCampaignController => {
  const { prisma, clock, idGenerator, logger } = deps;
  const { quotaGate, eligibilityVariantRepository } = shared;
  const moduleLogger = logger.child({ module: 'preorder' });

  const campaignRepository = new PrismaCampaignRepository(prisma);
  const reservationRepository = new PrismaReservationRepository(prisma);
  const transactionRunner = new PrismaTransactionRunner(prisma);
  const outboxWriter = new PrismaOutboxWriter(prisma, idGenerator, clock);
  const auditWriter: AuditWriter = new AmbientAuditWriter({
    auditLogRepository: new PrismaAuditLogRepository(prisma),
    idGenerator,
    clock,
  });

  return createVendorCampaignController({
    createCampaignUseCase: new CreateCampaignUseCase({
      campaignRepository,
      productVariantRepository: eligibilityVariantRepository,
      transactionRunner,
      auditWriter,
      idGenerator,
      clock,
      logger: moduleLogger,
    }),
    updateCampaignUseCase: new UpdateCampaignUseCase({
      campaignRepository,
      transactionRunner,
      quotaGate,
      clock,
      logger: moduleLogger,
    }),
    cancelCampaignUseCase: new CancelCampaignUseCase({
      campaignRepository,
      reservationRepository,
      quotaGate,
      transactionRunner,
      auditWriter,
      outboxWriter,
      clock,
      logger: moduleLogger,
    }),
    getCampaignUseCase: new GetCampaignUseCase({ campaignRepository }),
    listCampaignsUseCase: new ListCampaignsUseCase({ campaignRepository }),
    getCampaignDemandSummaryUseCase: new GetCampaignDemandSummaryUseCase({
      campaignRepository,
      reservationRepository,
    }),
  });
};

/**
 * The vendor-facing surface, built on the tenant-scoped `prisma` client —
 * split out of `createPreorderModule` purely to keep it under this
 * repository's function-length budget, the same reason `order.module.ts`'s
 * own `buildVendorOrderRouter` was.
 */
const buildVendorRouter = (deps: PreorderModuleDeps, shared: SharedCollaborators): Router => {
  const { accessTokenService, sessionDenylist, resolveVendorTenant } = deps;
  const controller = buildVendorCampaignController(deps, shared);

  return createVendorCampaignRouter(controller, {
    accessTokenService,
    sessionDenylist,
    resolveVendorTenant,
  });
};

/**
 * The unauthenticated public surface, built on `publicPrisma` — split out
 * for the same reason `buildVendorRouter` was.
 */
const buildPublicRouter = (deps: PreorderModuleDeps): Router => {
  const campaignRepository = new PrismaCampaignRepository(deps.publicPrisma);
  const controller = createPublicCampaignController({
    getPublicCampaignUseCase: new GetPublicCampaignUseCase({ campaignRepository }),
    listPublicCampaignsUseCase: new ListPublicCampaignsUseCase({ campaignRepository }),
  });
  return createPublicCampaignRouter(controller);
};

interface ReservationSurface {
  readonly router: Router;
  readonly createReservationUseCase: CreateReservationUseCase;
}

/**
 * The customer reservation/payment surface, built on `checkoutPrisma` —
 * split out for the same reason `buildVendorRouter` was.
 */
const buildReservationSurface = (
  deps: PreorderModuleDeps,
  shared: SharedCollaborators,
): ReservationSurface => {
  const {
    checkoutPrisma,
    prisma,
    accessTokenService,
    sessionDenylist,
    clock,
    idGenerator,
    logger,
  } = deps;
  const { quotaGate, preorderPaymentGateway, eligibilityVariantRepository } = shared;
  const moduleLogger = logger.child({ module: 'preorder' });

  const campaignRepository = new PrismaCampaignRepository(checkoutPrisma);
  const reservationRepository = new PrismaReservationRepository(checkoutPrisma);
  const paymentAttemptRepository = new PrismaPaymentAttemptRepository(checkoutPrisma);
  const transactionRunner = new CheckoutTransactionRunner(checkoutPrisma);
  const outboxWriter = new PrismaOutboxWriter(checkoutPrisma, idGenerator, clock);
  const idempotencyKeyRepository = new IdempotencyKeyRepository(checkoutPrisma);
  const addressRepository = new PrismaAddressRepository(prisma);

  const createReservationUseCase = new CreateReservationUseCase({
    campaignRepository,
    reservationRepository,
    addressRepository,
    productVariantRepository: eligibilityVariantRepository,
    quotaGate,
    transactionRunner,
    outboxWriter,
    idGenerator,
    clock,
    logger: moduleLogger,
    reservationTtlMs: 10 * 60 * 1000,
  });

  const controller = buildReservationControllerInstance({
    createReservationUseCase,
    reservationRepository,
    campaignRepository,
    paymentAttemptRepository,
    preorderPaymentGateway,
    quotaGate,
    outboxWriter,
    transactionRunner,
    idGenerator,
    clock,
    moduleLogger,
  });

  const router = createReservationRouter(controller, {
    accessTokenService,
    sessionDenylist,
    idempotencyKeyRepository,
    clock,
    idGenerator,
  });

  return { router, createReservationUseCase };
};

/**
 * This module's own composition root (SDD 2.3), mirroring `order.module.ts`'s
 * shape. Three credentials, three routers — `prisma` (vendor CRUD),
 * `publicPrisma` (unauthenticated browse), `checkoutPrisma` (customer
 * reservation/payment writes, including the campaign quantity mutation that
 * lives inside the same transaction as the reservation insert).
 */
export const createPreorderModule = (deps: PreorderModuleDeps): PreorderModule => {
  const shared: SharedCollaborators = {
    quotaGate: new RedisCampaignQuotaGate(deps.redis),
    preorderPaymentGateway: new MockPreorderPaymentGateway(deps.idGenerator),
    eligibilityVariantRepository: new PrismaProductVariantRepository(deps.publicPrisma),
  };

  const vendorRouter = buildVendorRouter(deps, shared);
  const publicRouter = buildPublicRouter(deps);
  const { router: reservationRouter, createReservationUseCase } = buildReservationSurface(
    deps,
    shared,
  );

  return {
    vendorRouter,
    publicRouter,
    reservationRouter,
    createReservationUseCase,
    quotaGate: shared.quotaGate,
  };
};
