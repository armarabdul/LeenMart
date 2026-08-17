import type { PrismaClient } from '@prisma/client';
import type { Router } from 'express';
import type { Clock, IdGenerator, Logger } from '@leen-mart/domain-kit';
import { AmbientAuditWriter, type AuditWriter } from '../audit/index.js';
import { PrismaAuditLogRepository } from '../audit/infrastructure/persistence/prisma-audit-log.repository.js';
import { PrismaCartItemRepository } from '../cart/infrastructure/persistence/prisma-cart-item.repository.js';
import { PrismaCartRepository } from '../cart/infrastructure/persistence/prisma-cart.repository.js';
import { PrismaProductRepository } from '../catalogue/infrastructure/persistence/prisma-product.repository.js';
import { PrismaProductVariantRepository } from '../catalogue/infrastructure/persistence/prisma-product-variant.repository.js';
import { PrismaInventoryRepository } from '../catalogue/infrastructure/persistence/prisma-inventory.repository.js';
import { PrismaAddressRepository } from '../customer/infrastructure/persistence/prisma-address.repository.js';
import type { AccessTokenService, SessionDenylist } from '../identity/index.js';
import { createPricingTaxModule } from '../pricing-tax/index.js';
import type { ResolveCommissionUseCase, ResolveTaxUseCase } from '../pricing-tax/index.js';
import { PrismaVendorRepository } from '../vendor/infrastructure/persistence/prisma-vendor.repository.js';
import type { Env } from '../../shared/config/env.js';
import {
  CheckoutTransactionRunner,
  PrismaTransactionRunner,
} from '../../shared/infrastructure/persistence/tenant-prisma.js';
import { IdempotencyKeyRepository } from '../../shared/infrastructure/persistence/idempotency-key.repository.js';
import { PrismaOutboxWriter } from '../../shared/infrastructure/persistence/prisma-outbox-writer.js';
import type { VendorTenantResolver } from '../../shared/interface/http/middleware/tenant-context.js';
import { PlaceOrderUseCase } from './application/use-cases/place-order.use-case.js';
import { DeliverSubOrderUseCase } from './application/use-cases/deliver-sub-order.use-case.js';
import { GetOrderUseCase } from './application/use-cases/get-order.use-case.js';
import { GetOrIssuePickupTokenUseCase } from './application/use-cases/get-or-issue-pickup-token.use-case.js';
import { GetVendorOrderUseCase } from './application/use-cases/get-vendor-order.use-case.js';
import { ListOrdersUseCase } from './application/use-cases/list-orders.use-case.js';
import { ListVendorOrdersUseCase } from './application/use-cases/list-vendor-orders.use-case.js';
import { CancelOrderUseCase } from './application/use-cases/cancel-order.use-case.js';
import { InitiatePaymentUseCase } from './application/use-cases/initiate-payment.use-case.js';
import { ConfirmPaymentUseCase } from './application/use-cases/confirm-payment.use-case.js';
import { MarkReadyForPickupUseCase } from './application/use-cases/mark-ready-for-pickup.use-case.js';
import { RedeemPickupTokenUseCase } from './application/use-cases/redeem-pickup-token.use-case.js';
import type { PostOrderPaymentJournalsUseCase } from '../ledger/index.js';
import { ShipSubOrderUseCase } from './application/use-cases/ship-sub-order.use-case.js';
import { StartProcessingUseCase } from './application/use-cases/start-processing.use-case.js';
import type { PickupTokenSigner } from './application/ports/pickup-token-signer.port.js';
import { Ed25519PickupTokenSigner } from './infrastructure/crypto/ed25519-pickup-token-signer.js';
import { PrismaOrderRepository } from './infrastructure/persistence/prisma-order.repository.js';
import { PrismaPaymentAttemptRepository } from './infrastructure/persistence/prisma-payment-attempt.repository.js';
import { PrismaPickupTokenRepository } from './infrastructure/persistence/prisma-pickup-token.repository.js';
import { PrismaVendorOrderRepository } from './infrastructure/persistence/prisma-vendor-order.repository.js';
import { MockPaymentGateway } from './infrastructure/payment/mock-payment-gateway.js';
import { createOrderController } from './interface/http/order.controller.js';
import { createOrderRouter } from './interface/http/order.routes.js';
import { createVendorOrderController } from './interface/http/vendor-order.controller.js';
import { createVendorOrderRouter } from './interface/http/vendor-order.routes.js';

export interface OrderModuleDeps {
  /** The plain, non-RLS client — cart/address reads, exactly the credential those two modules already use for themselves. */
  readonly prisma: PrismaClient;
  /** `leenmart_public` — fresh product/variant eligibility and price reads (SEC-02), the same precedent `AddCartItemUseCase` established. */
  readonly publicPrisma: PrismaClient;
  /** `leenmart_checkout` (S3-3A) — vendor reads, inventory decrement/restore, and the order module's own tables. */
  readonly checkoutPrisma: PrismaClient;
  /** S4-QR: `PICKUP_TOKEN_PRIVATE_KEY`/`PICKUP_TOKEN_PUBLIC_KEY`/`PICKUP_TOKEN_TTL_SECONDS` — the same whole-`Env` idiom `createIdentityModule` already uses for its own JWT config. */
  readonly env: Env;
  readonly accessTokenService: AccessTokenService;
  readonly sessionDenylist: SessionDenylist;
  /**
   * Resolves the caller's own vendor for `tenantContext` (S3-5) — the same
   * resolver `catalogue`'s vendor-facing router already receives from the
   * composition root, handed to this module for the identical reason (SDD
   * 5.1: only a resolver crosses from `vendor`, never its repositories or
   * entities).
   */
  readonly resolveVendorTenant: VendorTenantResolver;
  /**
   * S3-7's ledger posting, built by the composition root (S3-8: the ledger
   * module now also builds a vendor-facing router, so app.ts constructs one
   * shared `LedgerModule` instance and hands this collaborator in, rather
   * than this module minting a second, router-less instance of its own).
   */
  readonly postOrderPaymentJournalsUseCase: PostOrderPaymentJournalsUseCase;
  readonly clock: Clock;
  readonly idGenerator: IdGenerator;
  readonly logger: Logger;
}

export interface OrderModule {
  readonly router: Router;
  /** Mounted separately at `/api/v1/vendor/orders` (S3-5) — vendor-scoped, on `leenmart_app` rather than `leenmart_checkout`. */
  readonly vendorRouter: Router;
}

interface OrderRepositories {
  readonly cartRepository: PrismaCartRepository;
  readonly cartItemRepository: PrismaCartItemRepository;
  readonly addressRepository: PrismaAddressRepository;
  readonly productRepository: PrismaProductRepository;
  readonly productVariantRepository: PrismaProductVariantRepository;
  readonly vendorRepository: PrismaVendorRepository;
  readonly inventoryRepository: PrismaInventoryRepository;
  readonly orderRepository: PrismaOrderRepository;
  readonly paymentAttemptRepository: PrismaPaymentAttemptRepository;
  /** Bound to `checkoutPrisma` — the customer's own issue/rotate path, per the port's own doc comment. */
  readonly pickupTokenRepository: PrismaPickupTokenRepository;
  readonly outboxWriter: PrismaOutboxWriter;
  readonly idempotencyKeyRepository: IdempotencyKeyRepository;
  readonly transactionRunner: CheckoutTransactionRunner;
}

/**
 * Every repository/writer this module needs, on the three credentials S3-3A
 * approved. Split out of `createOrderModule` purely to keep it under this
 * file's function-length budget.
 */
const buildOrderRepositories = (
  deps: Pick<
    OrderModuleDeps,
    'prisma' | 'publicPrisma' | 'checkoutPrisma' | 'idGenerator' | 'clock'
  >,
): OrderRepositories => {
  const { prisma, publicPrisma, checkoutPrisma, idGenerator, clock } = deps;
  return {
    cartRepository: new PrismaCartRepository(prisma),
    cartItemRepository: new PrismaCartItemRepository(prisma),
    addressRepository: new PrismaAddressRepository(prisma),
    productRepository: new PrismaProductRepository(publicPrisma),
    productVariantRepository: new PrismaProductVariantRepository(publicPrisma),
    vendorRepository: new PrismaVendorRepository(checkoutPrisma),
    inventoryRepository: new PrismaInventoryRepository(checkoutPrisma),
    orderRepository: new PrismaOrderRepository(checkoutPrisma),
    paymentAttemptRepository: new PrismaPaymentAttemptRepository(checkoutPrisma),
    pickupTokenRepository: new PrismaPickupTokenRepository(checkoutPrisma),
    outboxWriter: new PrismaOutboxWriter(checkoutPrisma, idGenerator, clock),
    idempotencyKeyRepository: new IdempotencyKeyRepository(checkoutPrisma),
    transactionRunner: new CheckoutTransactionRunner(checkoutPrisma),
  };
};

interface OrderUseCases {
  readonly placeOrderUseCase: PlaceOrderUseCase;
  readonly getOrderUseCase: GetOrderUseCase;
  readonly listOrdersUseCase: ListOrdersUseCase;
  readonly cancelOrderUseCase: CancelOrderUseCase;
  readonly initiatePaymentUseCase: InitiatePaymentUseCase;
  readonly confirmPaymentUseCase: ConfirmPaymentUseCase;
  readonly getOrIssuePickupTokenUseCase: GetOrIssuePickupTokenUseCase;
}

interface BuildOrderUseCasesDeps {
  readonly repositories: OrderRepositories;
  readonly paymentGateway: MockPaymentGateway;
  readonly resolveCommissionUseCase: ResolveCommissionUseCase;
  readonly resolveTaxUseCase: ResolveTaxUseCase;
  /** S3-7: the ledger posting driven by a captured payment. */
  readonly postOrderPaymentJournalsUseCase: PostOrderPaymentJournalsUseCase;
  /** S4-QR: shared by both the customer issue/rotate path and the vendor redeem path — one instance, two callers. */
  readonly pickupTokenSigner: PickupTokenSigner;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
  readonly logger: Logger;
}

/** `PlaceOrderUseCase` alone — its dependency list is long enough to be its own builder, keeping `buildCheckoutUseCases` within this file's line budget. */
const buildPlaceOrderUseCase = (deps: BuildOrderUseCasesDeps): PlaceOrderUseCase =>
  new PlaceOrderUseCase({
    ...deps.repositories,
    resolveCommissionUseCase: deps.resolveCommissionUseCase,
    resolveTaxUseCase: deps.resolveTaxUseCase,
    idGenerator: deps.idGenerator,
    clock: deps.clock,
    logger: deps.logger,
  });

/** S4-QR's customer-facing token issuance — its own builder so `buildCheckoutUseCases` stays within this file's function-length budget. */
const buildPickupTokenUseCase = (
  deps: BuildOrderUseCasesDeps,
): Pick<OrderUseCases, 'getOrIssuePickupTokenUseCase'> => ({
  getOrIssuePickupTokenUseCase: new GetOrIssuePickupTokenUseCase({
    orderRepository: deps.repositories.orderRepository,
    pickupTokenRepository: deps.repositories.pickupTokenRepository,
    pickupTokenSigner: deps.pickupTokenSigner,
    idGenerator: deps.idGenerator,
    logger: deps.logger,
  }),
});

/** `PlaceOrderUseCase`/`GetOrderUseCase`/`ListOrdersUseCase`/`CancelOrderUseCase` — split out of `buildOrderUseCases` purely to keep every function under this file's line budget. */
const buildCheckoutUseCases = (
  deps: BuildOrderUseCasesDeps,
): Pick<
  OrderUseCases,
  | 'placeOrderUseCase'
  | 'getOrderUseCase'
  | 'listOrdersUseCase'
  | 'cancelOrderUseCase'
  | 'getOrIssuePickupTokenUseCase'
> => {
  const { repositories, clock, logger } = deps;
  const { inventoryRepository, orderRepository, outboxWriter, transactionRunner } = repositories;

  const placeOrderUseCase = buildPlaceOrderUseCase(deps);
  const getOrderUseCase = new GetOrderUseCase({ orderRepository });
  const listOrdersUseCase = new ListOrdersUseCase({ orderRepository });
  const cancelOrderUseCase = new CancelOrderUseCase({
    orderRepository,
    inventoryRepository,
    outboxWriter,
    transactionRunner,
    clock,
    logger,
  });
  return {
    placeOrderUseCase,
    getOrderUseCase,
    listOrdersUseCase,
    cancelOrderUseCase,
    ...buildPickupTokenUseCase(deps),
  };
};

/** `InitiatePaymentUseCase`/`ConfirmPaymentUseCase` (S3-3B) — split out for the same reason as `buildCheckoutUseCases`. */
const buildPaymentUseCases = (
  deps: BuildOrderUseCasesDeps,
): Pick<OrderUseCases, 'initiatePaymentUseCase' | 'confirmPaymentUseCase'> => {
  const {
    repositories,
    paymentGateway,
    postOrderPaymentJournalsUseCase,
    idGenerator,
    clock,
    logger,
  } = deps;
  const { orderRepository, paymentAttemptRepository, outboxWriter, transactionRunner } =
    repositories;

  const initiatePaymentUseCase = new InitiatePaymentUseCase({
    orderRepository,
    paymentAttemptRepository,
    paymentGateway,
    outboxWriter,
    transactionRunner,
    idGenerator,
    clock,
    logger,
  });
  const confirmPaymentUseCase = new ConfirmPaymentUseCase({
    orderRepository,
    paymentAttemptRepository,
    paymentGateway,
    outboxWriter,
    postOrderPaymentJournalsUseCase,
    transactionRunner,
    clock,
    logger,
  });

  return { initiatePaymentUseCase, confirmPaymentUseCase };
};

/**
 * Every use case this module exposes. Split out of `createOrderModule`
 * purely to keep it under this file's function-length budget — same
 * reasoning as `buildOrderRepositories`.
 */
const buildOrderUseCases = (deps: BuildOrderUseCasesDeps): OrderUseCases => ({
  ...buildCheckoutUseCases(deps),
  ...buildPaymentUseCases(deps),
});

interface VendorOrderUseCases {
  readonly listVendorOrdersUseCase: ListVendorOrdersUseCase;
  readonly getVendorOrderUseCase: GetVendorOrderUseCase;
  readonly startProcessingUseCase: StartProcessingUseCase;
  readonly shipSubOrderUseCase: ShipSubOrderUseCase;
  readonly deliverSubOrderUseCase: DeliverSubOrderUseCase;
  readonly markReadyForPickupUseCase: MarkReadyForPickupUseCase;
  readonly redeemPickupTokenUseCase: RedeemPickupTokenUseCase;
}

/**
 * Every vendor-facing use case (S3-5's `startProcessingUseCase`, S3-6's
 * `shipSubOrderUseCase`/`deliverSubOrderUseCase`, S4-QR's
 * `markReadyForPickupUseCase`/`redeemPickupTokenUseCase`), split out of
 * `buildVendorOrderRouter` purely to keep it under this file's
 * function-length budget — same reasoning as `buildCheckoutUseCases`/
 * `buildPaymentUseCases` above. The four mutating use cases share the exact
 * same dependency shape (S3-6/S4-QR reuse S3-5's, not a new one) except
 * `redeemPickupTokenUseCase`, which additionally needs the tenant-scoped
 * `pickupTokenRepository` and the shared `pickupTokenSigner`.
 */
const buildVendorOrderUseCases = (deps: {
  vendorRepository: PrismaVendorRepository;
  vendorOrderRepository: PrismaVendorOrderRepository;
  pickupTokenRepository: PrismaPickupTokenRepository;
  pickupTokenSigner: PickupTokenSigner;
  outboxWriter: PrismaOutboxWriter;
  auditWriter: AuditWriter;
  transactionRunner: PrismaTransactionRunner;
  clock: Clock;
  logger: Logger;
}): VendorOrderUseCases => {
  const {
    vendorRepository,
    vendorOrderRepository,
    pickupTokenRepository,
    pickupTokenSigner,
    outboxWriter,
    auditWriter,
    transactionRunner,
    clock,
    logger,
  } = deps;
  const mutatingDeps = {
    vendorRepository,
    vendorOrderRepository,
    outboxWriter,
    auditWriter,
    transactionRunner,
    clock,
    logger,
  };

  return {
    listVendorOrdersUseCase: new ListVendorOrdersUseCase({
      vendorRepository,
      vendorOrderRepository,
    }),
    getVendorOrderUseCase: new GetVendorOrderUseCase({ vendorRepository, vendorOrderRepository }),
    startProcessingUseCase: new StartProcessingUseCase(mutatingDeps),
    shipSubOrderUseCase: new ShipSubOrderUseCase(mutatingDeps),
    deliverSubOrderUseCase: new DeliverSubOrderUseCase(mutatingDeps),
    markReadyForPickupUseCase: new MarkReadyForPickupUseCase(mutatingDeps),
    redeemPickupTokenUseCase: new RedeemPickupTokenUseCase({
      ...mutatingDeps,
      pickupTokenRepository,
      pickupTokenSigner,
    }),
  };
};

/**
 * The vendor-facing surface (S3-5) — deliberately built on the *tenant-scoped*
 * `prisma` client (`leenmart_app`), never `checkoutPrisma`, per locked
 * decision #2. Split out of `createOrderModule` for the same
 * function-length-budget reason every other builder in this file is.
 */
const buildVendorOrderRouter = (params: {
  prisma: PrismaClient;
  accessTokenService: AccessTokenService;
  sessionDenylist: SessionDenylist;
  resolveVendorTenant: VendorTenantResolver;
  /** S4-QR: the same signer instance the customer-facing issue/rotate path uses. */
  pickupTokenSigner: PickupTokenSigner;
  idGenerator: IdGenerator;
  clock: Clock;
  logger: Logger;
}): Router => {
  const {
    prisma,
    accessTokenService,
    sessionDenylist,
    resolveVendorTenant,
    pickupTokenSigner,
    idGenerator,
    clock,
    logger,
  } = params;

  // A second `VendorRepository` instance, bound to the tenant-scoped client
  // rather than `checkoutPrisma` — `buildOrderRepositories`'s own
  // `vendorRepository` exists only to resolve plan/status/shopName for the
  // *sold-from* vendor at checkout time; the ACTIVE gate here checks the
  // *requesting* vendor's own profile instead, which must read through RLS.
  const vendorRepository = new PrismaVendorRepository(prisma);
  const vendorOrderRepository = new PrismaVendorOrderRepository(prisma);
  // Bound to the tenant-scoped client, unlike `buildOrderRepositories`'s own
  // `pickupTokenRepository` (`checkoutPrisma`) — RLS is what makes this the
  // *vendor's own* redemption path (the port's own doc comment).
  const pickupTokenRepository = new PrismaPickupTokenRepository(prisma);
  const transactionRunner = new PrismaTransactionRunner(prisma);
  const outboxWriter = new PrismaOutboxWriter(prisma, idGenerator, clock);
  const auditWriter: AuditWriter = new AmbientAuditWriter({
    auditLogRepository: new PrismaAuditLogRepository(prisma),
    idGenerator,
    clock,
  });

  const controller = createVendorOrderController(
    buildVendorOrderUseCases({
      vendorRepository,
      vendorOrderRepository,
      pickupTokenRepository,
      pickupTokenSigner,
      outboxWriter,
      auditWriter,
      transactionRunner,
      clock,
      logger,
    }),
  );
  return createVendorOrderRouter(controller, {
    accessTokenService,
    sessionDenylist,
    resolveVendorTenant,
  });
};

/**
 * This module's own composition root (SDD 2.3), mirroring every other
 * module's shape. Constructs `pricing-tax` itself (S3-2's own doc comment
 * names this module as its "intended caller") on the plain client —
 * `commission_rules`/`tax_rates` carry no RLS, the same reasoning that
 * module's own `PricingTaxModuleDeps.prisma` comment already states.
 */
export const createOrderModule = (deps: OrderModuleDeps): OrderModule => {
  const {
    prisma,
    env,
    accessTokenService,
    sessionDenylist,
    resolveVendorTenant,
    postOrderPaymentJournalsUseCase,
    clock,
    idGenerator,
    logger,
  } = deps;
  const moduleLogger = logger.child({ module: 'order' });

  const repositories = buildOrderRepositories(deps);
  const paymentGateway = new MockPaymentGateway(idGenerator);
  const { resolveCommissionUseCase, resolveTaxUseCase } = createPricingTaxModule({ prisma, clock });
  // S4-QR: one signer instance, shared by the customer issue/rotate path
  // (below) and the vendor redeem path (`buildVendorOrderRouter`) — signs
  // with the private key, verifies with the public key, so both directions
  // go through the same Ed25519 keypair either way.
  const pickupTokenSigner: PickupTokenSigner = new Ed25519PickupTokenSigner(
    {
      privateKeyPem: env.PICKUP_TOKEN_PRIVATE_KEY,
      publicKeyPem: env.PICKUP_TOKEN_PUBLIC_KEY,
      ttlSeconds: env.PICKUP_TOKEN_TTL_SECONDS,
    },
    clock,
  );

  const useCases = buildOrderUseCases({
    repositories,
    paymentGateway,
    resolveCommissionUseCase,
    resolveTaxUseCase,
    postOrderPaymentJournalsUseCase,
    pickupTokenSigner,
    idGenerator,
    clock,
    logger: moduleLogger,
  });

  const controller = createOrderController(useCases);
  const router = createOrderRouter(controller, {
    accessTokenService,
    sessionDenylist,
    idempotencyKeyRepository: repositories.idempotencyKeyRepository,
    clock,
    idGenerator,
  });

  const vendorRouter = buildVendorOrderRouter({
    prisma,
    accessTokenService,
    sessionDenylist,
    resolveVendorTenant,
    pickupTokenSigner,
    idGenerator,
    clock,
    logger: moduleLogger,
  });

  return { router, vendorRouter };
};
