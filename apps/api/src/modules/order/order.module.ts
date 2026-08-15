import type { PrismaClient } from '@prisma/client';
import type { Router } from 'express';
import type { Clock, IdGenerator, Logger } from '@leen-mart/domain-kit';
import { PrismaCartItemRepository } from '../cart/infrastructure/persistence/prisma-cart-item.repository.js';
import { PrismaCartRepository } from '../cart/infrastructure/persistence/prisma-cart.repository.js';
import { PrismaProductRepository } from '../catalogue/infrastructure/persistence/prisma-product.repository.js';
import { PrismaProductVariantRepository } from '../catalogue/infrastructure/persistence/prisma-product-variant.repository.js';
import { PrismaInventoryRepository } from '../catalogue/infrastructure/persistence/prisma-inventory.repository.js';
import { PrismaAddressRepository } from '../customer/infrastructure/persistence/prisma-address.repository.js';
import type { AccessTokenService, SessionDenylist } from '../identity/index.js';
import { createPricingTaxModule } from '../pricing-tax/index.js';
import { PrismaVendorRepository } from '../vendor/infrastructure/persistence/prisma-vendor.repository.js';
import { CheckoutTransactionRunner } from '../../shared/infrastructure/persistence/tenant-prisma.js';
import { IdempotencyKeyRepository } from '../../shared/infrastructure/persistence/idempotency-key.repository.js';
import { PrismaOutboxWriter } from '../../shared/infrastructure/persistence/prisma-outbox-writer.js';
import { PlaceOrderUseCase } from './application/use-cases/place-order.use-case.js';
import { GetOrderUseCase } from './application/use-cases/get-order.use-case.js';
import { CancelOrderUseCase } from './application/use-cases/cancel-order.use-case.js';
import { PrismaOrderRepository } from './infrastructure/persistence/prisma-order.repository.js';
import { createOrderController } from './interface/http/order.controller.js';
import { createOrderRouter } from './interface/http/order.routes.js';

export interface OrderModuleDeps {
  /** The plain, non-RLS client — cart/address reads, exactly the credential those two modules already use for themselves. */
  readonly prisma: PrismaClient;
  /** `leenmart_public` — fresh product/variant eligibility and price reads (SEC-02), the same precedent `AddCartItemUseCase` established. */
  readonly publicPrisma: PrismaClient;
  /** `leenmart_checkout` (S3-3A) — vendor reads, inventory decrement/restore, and the order module's own tables. */
  readonly checkoutPrisma: PrismaClient;
  readonly accessTokenService: AccessTokenService;
  readonly sessionDenylist: SessionDenylist;
  readonly clock: Clock;
  readonly idGenerator: IdGenerator;
  readonly logger: Logger;
}

export interface OrderModule {
  readonly router: Router;
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
    outboxWriter: new PrismaOutboxWriter(checkoutPrisma, idGenerator, clock),
    idempotencyKeyRepository: new IdempotencyKeyRepository(checkoutPrisma),
    transactionRunner: new CheckoutTransactionRunner(checkoutPrisma),
  };
};

/**
 * This module's own composition root (SDD 2.3), mirroring every other
 * module's shape. Constructs `pricing-tax` itself (S3-2's own doc comment
 * names this module as its "intended caller") on the plain client —
 * `commission_rules`/`tax_rates` carry no RLS, the same reasoning that
 * module's own `PricingTaxModuleDeps.prisma` comment already states.
 */
export const createOrderModule = (deps: OrderModuleDeps): OrderModule => {
  const { prisma, accessTokenService, sessionDenylist, clock, idGenerator, logger } = deps;
  const moduleLogger = logger.child({ module: 'order' });

  const {
    cartRepository,
    cartItemRepository,
    addressRepository,
    productRepository,
    productVariantRepository,
    vendorRepository,
    inventoryRepository,
    orderRepository,
    outboxWriter,
    idempotencyKeyRepository,
    transactionRunner,
  } = buildOrderRepositories(deps);

  const { resolveCommissionUseCase, resolveTaxUseCase } = createPricingTaxModule({ prisma, clock });

  const placeOrderUseCase = new PlaceOrderUseCase({
    cartRepository,
    cartItemRepository,
    addressRepository,
    productRepository,
    productVariantRepository,
    vendorRepository,
    inventoryRepository,
    orderRepository,
    outboxWriter,
    transactionRunner,
    resolveCommissionUseCase,
    resolveTaxUseCase,
    idGenerator,
    clock,
    logger: moduleLogger,
  });
  const getOrderUseCase = new GetOrderUseCase({ orderRepository });
  const cancelOrderUseCase = new CancelOrderUseCase({
    orderRepository,
    inventoryRepository,
    outboxWriter,
    transactionRunner,
    clock,
    logger: moduleLogger,
  });

  const controller = createOrderController({
    placeOrderUseCase,
    getOrderUseCase,
    cancelOrderUseCase,
  });
  const router = createOrderRouter(controller, {
    accessTokenService,
    sessionDenylist,
    idempotencyKeyRepository,
    clock,
    idGenerator,
  });

  return { router };
};
