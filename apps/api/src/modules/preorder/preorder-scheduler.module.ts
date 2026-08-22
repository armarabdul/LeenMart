import type { PrismaClient } from '@prisma/client';
import type { Redis } from 'ioredis';
import type { Clock, IdGenerator, Logger } from '@leen-mart/domain-kit';
import type { ScheduledJob } from '../../shared/application/ports/scheduled-job.port.js';
import { PrismaOutboxWriter } from '../../shared/infrastructure/persistence/prisma-outbox-writer.js';
import { CheckoutTransactionRunner } from '../../shared/infrastructure/persistence/tenant-prisma.js';
import { PrismaAddressRepository } from '../customer/infrastructure/persistence/prisma-address.repository.js';
import { PrismaProductRepository } from '../catalogue/infrastructure/persistence/prisma-product.repository.js';
import { PrismaProductVariantRepository } from '../catalogue/infrastructure/persistence/prisma-product-variant.repository.js';
import { PrismaVendorRepository } from '../vendor/infrastructure/persistence/prisma-vendor.repository.js';
import { PrismaOrderRepository } from '../order/infrastructure/persistence/prisma-order.repository.js';
import { createPricingTaxModule } from '../pricing-tax/index.js';
import { PostOrderPaymentJournalsUseCase } from '../ledger/application/use-cases/post-order-payment-journals.use-case.js';
import { PrismaLedgerRepository } from '../ledger/infrastructure/persistence/prisma-ledger.repository.js';
import { PrismaCampaignRepository } from './infrastructure/persistence/prisma-campaign.repository.js';
import { PrismaReservationRepository } from './infrastructure/persistence/prisma-reservation.repository.js';
import { RedisCampaignQuotaGate } from './infrastructure/cache/redis-campaign-quota-gate.js';
import { SweepCampaignLifecycleUseCase } from './application/use-cases/sweep-campaign-lifecycle.use-case.js';
import { SweepReservationExpiryUseCase } from './application/use-cases/sweep-reservation-expiry.use-case.js';
import { ReconcileRedisQuantityUseCase } from './application/use-cases/reconcile-redis-quantity.use-case.js';
import { ConvertReservationToOrderUseCase } from './application/use-cases/convert-reservation-to-order.use-case.js';

/**
 * This module's own worker-only composition root — a separate file and
 * separate exported function from `createPreorderModule`, mirroring
 * `order-scheduler.module.ts`'s own reasoning exactly: this builds
 * `ScheduledJob`s, never a router, so it has no place in the API-process
 * composition root.
 */
export interface PreorderSchedulerWorkerModuleDeps {
  /** The plain, non-RLS client — address reads, the same credential `order.module.ts`'s own `addressRepository` uses. */
  readonly prisma: PrismaClient;
  /** `leenmart_public` — fresh product/variant eligibility reads at conversion time, the same `AddCartItemUseCase`/`PlaceOrderUseCase` precedent. */
  readonly publicPrisma: PrismaClient;
  /** `leenmart_checkout` — every sweep here reads/writes `preorder_campaigns`/`preorder_reservations` on the same credential the customer-facing use cases do (this migration's own grant, mirroring `orders`), not the vendor tenant client, since a sweep is cross-vendor by nature. Also where `orders`/`ledger_journals` are written on conversion — the same credential `PlaceOrderUseCase`/`ConfirmPaymentUseCase` write them on. */
  readonly checkoutPrisma: PrismaClient;
  readonly redis: Redis;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
  readonly logger: Logger;
}

export interface PreorderSchedulerWorkerModule {
  readonly campaignLifecycleJob: ScheduledJob;
  readonly reservationExpiryJob: ScheduledJob;
  readonly redisReconciliationJob: ScheduledJob;
}

export const createPreorderSchedulerWorkerModule = (
  deps: PreorderSchedulerWorkerModuleDeps,
): PreorderSchedulerWorkerModule => {
  const { prisma, publicPrisma, checkoutPrisma, redis, idGenerator, clock, logger } = deps;
  const moduleLogger = logger.child({ module: 'preorder-scheduler' });

  const campaignRepository = new PrismaCampaignRepository(checkoutPrisma);
  const reservationRepository = new PrismaReservationRepository(checkoutPrisma);
  const quotaGate = new RedisCampaignQuotaGate(redis);
  const outboxWriter = new PrismaOutboxWriter(checkoutPrisma, idGenerator, clock);

  // The conversion hand-off's own collaborators — mirrors `order.module.ts`'s
  // own credential choices exactly: addresses on the plain client, product/
  // variant eligibility on `leenmart_public`, vendor/order/ledger on
  // `leenmart_checkout`.
  const { resolveCommissionUseCase, resolveTaxUseCase } = createPricingTaxModule({ prisma, clock });
  const convertReservationToOrderUseCase = new ConvertReservationToOrderUseCase({
    reservationRepository,
    campaignRepository,
    addressRepository: new PrismaAddressRepository(prisma),
    productRepository: new PrismaProductRepository(publicPrisma),
    productVariantRepository: new PrismaProductVariantRepository(publicPrisma),
    vendorRepository: new PrismaVendorRepository(checkoutPrisma),
    orderRepository: new PrismaOrderRepository(checkoutPrisma),
    resolveCommissionUseCase,
    resolveTaxUseCase,
    postOrderPaymentJournalsUseCase: new PostOrderPaymentJournalsUseCase({
      ledgerRepository: new PrismaLedgerRepository(checkoutPrisma),
      idGenerator,
    }),
    outboxWriter,
    transactionRunner: new CheckoutTransactionRunner(checkoutPrisma),
    idGenerator,
    clock,
    logger: moduleLogger,
  });

  return {
    campaignLifecycleJob: new SweepCampaignLifecycleUseCase({
      campaignRepository,
      reservationRepository,
      quotaGate,
      outboxWriter,
      convertReservationToOrderUseCase,
      clock,
      logger: moduleLogger,
    }),
    reservationExpiryJob: new SweepReservationExpiryUseCase({
      reservationRepository,
      campaignRepository,
      quotaGate,
      outboxWriter,
      clock,
      logger: moduleLogger,
    }),
    redisReconciliationJob: new ReconcileRedisQuantityUseCase({
      campaignRepository,
      quotaGate,
      logger: moduleLogger,
    }),
  };
};
