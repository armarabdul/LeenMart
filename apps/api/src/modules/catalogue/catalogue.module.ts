import type { PrismaClient } from '@prisma/client';
import type { Router } from 'express';
import type { Redis } from 'ioredis';
import type { Clock, IdGenerator, Logger, TransactionRunner } from '@leen-mart/domain-kit';
import { AmbientAuditWriter, type AuditWriter } from '../audit/index.js';
import { PrismaAuditLogRepository } from '../audit/infrastructure/persistence/prisma-audit-log.repository.js';
import type { AccessTokenService, SessionDenylist } from '../identity/index.js';
import type { Env } from '../../shared/config/env.js';
import { AdminTransactionRunner } from '../../shared/infrastructure/persistence/tenant-prisma.js';
import type { ObjectStore } from '../media/index.js';
import { CreateCategoryUseCase } from './application/use-cases/create-category.use-case.js';
import { DeleteCategoryUseCase } from './application/use-cases/delete-category.use-case.js';
import { GetCategoryUseCase } from './application/use-cases/get-category.use-case.js';
import { ListCategoriesUseCase } from './application/use-cases/list-categories.use-case.js';
import { ReparentCategoryUseCase } from './application/use-cases/reparent-category.use-case.js';
import { UpdateCategoryUseCase } from './application/use-cases/update-category.use-case.js';
import { AddCategoryAttributeUseCase } from './application/use-cases/add-category-attribute.use-case.js';
import { GetCategoryAttributeUseCase } from './application/use-cases/get-category-attribute.use-case.js';
import { GetPublicCategoryUseCase } from './application/use-cases/get-public-category.use-case.js';
import { GetPublicCategoryTreeUseCase } from './application/use-cases/get-public-category-tree.use-case.js';
import { ListCategoryAttributesUseCase } from './application/use-cases/list-category-attributes.use-case.js';
import { RemoveCategoryAttributeUseCase } from './application/use-cases/remove-category-attribute.use-case.js';
import { UpdateCategoryAttributeUseCase } from './application/use-cases/update-category-attribute.use-case.js';
import { PrismaCategoryAttributeRepository } from './infrastructure/persistence/prisma-category-attribute.repository.js';
import { PrismaCategoryRepository } from './infrastructure/persistence/prisma-category.repository.js';
import { createAdminCategoryAttributeController } from './interface/http/admin-category-attribute.controller.js';
import { createAdminCategoryController } from './interface/http/admin-category.controller.js';
import { createAdminCategoryRouter } from './interface/http/admin-category.routes.js';
import {
  createPublicCategoryController,
  type PublicCategoryController,
} from './interface/http/public-category.controller.js';
import { createPublicCategoryRouter } from './interface/http/public-category.routes.js';
import type { CategoryRepository } from './domain/repositories/category.repository.js';
import type { VendorTenantResolver } from '../../shared/interface/http/middleware/tenant-context.js';
import { PrismaTransactionRunner } from '../../shared/infrastructure/persistence/tenant-prisma.js';
import { CreateProductUseCase } from './application/use-cases/create-product.use-case.js';
import { UpdateProductUseCase } from './application/use-cases/update-product.use-case.js';
import { GetProductUseCase } from './application/use-cases/get-product.use-case.js';
import { ListProductsUseCase } from './application/use-cases/list-products.use-case.js';
import { DeleteProductUseCase } from './application/use-cases/delete-product.use-case.js';
import { AddProductVariantUseCase } from './application/use-cases/add-product-variant.use-case.js';
import { UpdateProductVariantUseCase } from './application/use-cases/update-product-variant.use-case.js';
import { GetProductVariantUseCase } from './application/use-cases/get-product-variant.use-case.js';
import { ListProductVariantsUseCase } from './application/use-cases/list-product-variants.use-case.js';
import { RemoveProductVariantUseCase } from './application/use-cases/remove-product-variant.use-case.js';
import { SubmitProductForReviewUseCase } from './application/use-cases/submit-product-for-review.use-case.js';
import { ListProductReviewQueueUseCase } from './application/use-cases/list-product-review-queue.use-case.js';
import { GetProductReviewUseCase } from './application/use-cases/get-product-review.use-case.js';
import { DecideProductUseCase } from './application/use-cases/decide-product.use-case.js';
import { CreateProductMediaUploadIntentUseCase } from './application/use-cases/create-product-media-upload-intent.use-case.js';
import { CompleteProductMediaUploadUseCase } from './application/use-cases/complete-product-media-upload.use-case.js';
import { ListProductMediaUseCase } from './application/use-cases/list-product-media.use-case.js';
import { RemoveProductMediaUseCase } from './application/use-cases/remove-product-media.use-case.js';
import type { ProductMediaProcessingQueue } from './application/ports/product-media-processing-queue.port.js';
import { PrismaProductRepository } from './infrastructure/persistence/prisma-product.repository.js';
import { PrismaProductVariantRepository } from './infrastructure/persistence/prisma-product-variant.repository.js';
import { PrismaProductMediaRepository } from './infrastructure/persistence/prisma-product-media.repository.js';
import { BullMqProductMediaProcessingQueue } from './infrastructure/jobs/product-media-queue.js';
import { buildProductMediaObjectStore } from './infrastructure/storage/product-media-object-store.js';
import { PrismaInventoryRepository } from './infrastructure/persistence/prisma-inventory.repository.js';
import { PrismaProductReviewQuery } from './infrastructure/persistence/prisma-product-review-query.js';
import type { InventoryRepository } from './domain/repositories/inventory.repository.js';
import { GetInventoryUseCase } from './application/use-cases/get-inventory.use-case.js';
import { SetInventoryUseCase } from './application/use-cases/set-inventory.use-case.js';
import {
  createVendorInventoryController,
  type VendorInventoryController,
} from './interface/http/vendor-inventory.controller.js';
import { createVendorProductController } from './interface/http/vendor-product.controller.js';
import { createVendorProductVariantController } from './interface/http/vendor-product-variant.controller.js';
import { createVendorProductMediaController } from './interface/http/vendor-product-media.controller.js';
import { createVendorProductRouter } from './interface/http/vendor-product.routes.js';
import { createAdminProductController } from './interface/http/admin-product.controller.js';
import { createAdminProductRouter } from './interface/http/admin-product.routes.js';
import { SearchProductsUseCase } from './application/use-cases/search-products.use-case.js';
import { PrismaProductSearchQuery } from './infrastructure/persistence/prisma-product-search-query.js';
import { createPublicSearchController } from './interface/http/public-search.controller.js';
import { createPublicSearchRouter } from './interface/http/public-search.routes.js';

export interface CatalogueModuleDeps {
  /**
   * The elevated credential. Categories carry no tenant column and no RLS
   * policy, so this is not about bypassing isolation — it is that the taxonomy
   * is an admin-owned surface, and building it on the same credential the rest
   * of the admin console uses keeps one story about which role writes what.
   */
  readonly adminPrisma: PrismaClient;
  /**
   * The ordinary app-tier credential (S2-2c). `Category`/`CategoryAttribute`
   * are not in `TENANT_SCOPED_MODELS`, so `withTenantBoundary` passes queries
   * against them straight through with no context required — exactly what an
   * unauthenticated public read needs. This is deliberately not `adminPrisma`:
   * the public surface has no admin authority to spend, and reading on the
   * elevated credential for a route anyone can call would blur the one story
   * `adminPrisma` above is for.
   */
  readonly prisma: PrismaClient;
  /**
   * The unauthenticated public search credential (`leenmart_public`, S2-7).
   * Never `prisma` or `adminPrisma`: `products_public_read`'s RLS policy is
   * what structurally confines this surface to `APPROVED`, non-deleted rows
   * regardless of what a caller asks for — a query issued on either other
   * client would either see nothing (no tenant context) or every vendor's
   * full lifecycle (the admin grant), neither of which is "public".
   */
  readonly publicPrisma: PrismaClient;
  /** `PRODUCT_MEDIA_S3_*` (S2-6a) lives here, the same source `vendor.module.ts` reads its own `KYC_S3_*` block from. */
  readonly env: Env;
  /**
   * The BullMQ-dedicated Redis connection (S2-6b) — used here only to
   * *enqueue*; the consumer lives in its own process. Never
   * `container.redis`: see `createBullMqRedisClient` for why the two cannot
   * share a client.
   */
  readonly bullRedis: Redis;
  /** The general-purpose connection (S2-7) — `createSearchRateLimiter`'s two budgets are counted here, the same client the global limiter in `app.ts` already uses. */
  readonly redis: Redis;
  readonly accessTokenService: AccessTokenService;
  readonly sessionDenylist: SessionDenylist;
  /**
   * Handed over by the composition root, never derived here (S2-3 D-1).
   *
   * The vendor-facing product routes need a tenant, and SDD 5.1 forbids this
   * module from importing `vendor`'s repositories or entities to find one. A
   * resolver is the whole of the dependency: one id in, one id out.
   */
  readonly resolveVendorTenant: VendorTenantResolver;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
  readonly logger: Logger;
}

export interface CatalogueModule {
  readonly adminCategoryRouter: Router;
  readonly publicCategoryRouter: Router;
  /** Mounted at `/api/v1/vendor/products` — tenant-scoped, unlike the two above (S2-3b). */
  readonly vendorProductRouter: Router;
  /** Mounted at `/api/v1/admin/products` — cross-tenant on `adminPrisma`, no tenant context (S2-5). */
  readonly adminProductRouter: Router;
  /** Mounted at `/api/v1/search` — unauthenticated (auth optional), on `publicPrisma`, no tenant context (S2-7). */
  readonly publicSearchRouter: Router;
}

/** Split out purely to keep `createCatalogueModule` under this file's line budget. */
const buildPublicCategoryController = (
  categoryRepository: CategoryRepository,
): PublicCategoryController =>
  createPublicCategoryController({
    getPublicCategoryTreeUseCase: new GetPublicCategoryTreeUseCase({ categoryRepository }),
    getPublicCategoryUseCase: new GetPublicCategoryUseCase({ categoryRepository }),
  });

/**
 * The vendor-facing product surface (S2-3b), built as one unit.
 *
 * Split out of `createCatalogueModule` for the same reason
 * `buildPublicCategoryController` was: it keeps each function within this
 * file's line budget as the module's third surface lands.
 *
 * Everything here runs on the tenant-scoped `prisma`, never `adminPrisma`:
 * `Product` and `ProductVariant` are in `TENANT_SCOPED_MODELS`, so the client
 * is what confines a vendor's reads and writes to their own rows, with RLS
 * enforcing the same boundary beneath it. The audit writer and the transaction
 * runner are built on that same client so an audit row joins the very
 * transaction the product write is in.
 */
/** The two stock-route use cases, split out for the same line-budget reason as the builder below. */
const buildVendorInventoryController = (params: {
  inventoryRepository: InventoryRepository;
  transactionRunner: TransactionRunner;
  auditWriter: AuditWriter;
  clock: Clock;
  logger: Logger;
}): VendorInventoryController =>
  createVendorInventoryController({
    getInventoryUseCase: new GetInventoryUseCase({
      inventoryRepository: params.inventoryRepository,
    }),
    setInventoryUseCase: new SetInventoryUseCase(params),
  });

interface VendorProductShared {
  readonly productRepository: PrismaProductRepository;
  readonly productVariantRepository: PrismaProductVariantRepository;
  readonly productMediaRepository: PrismaProductMediaRepository;
  readonly inventoryRepository: PrismaInventoryRepository;
  readonly transactionRunner: PrismaTransactionRunner;
  readonly auditWriter: AmbientAuditWriter;
  readonly clock: Clock;
  readonly logger: Logger;
}

/** The repositories and cross-cutting deps every product/variant/media/inventory use case shares. */
const buildVendorProductShared = (params: {
  prisma: PrismaClient;
  idGenerator: IdGenerator;
  clock: Clock;
  logger: Logger;
}): VendorProductShared => {
  const { prisma, idGenerator, clock, logger } = params;
  return {
    productRepository: new PrismaProductRepository(prisma),
    productMediaRepository: new PrismaProductMediaRepository(prisma),
    productVariantRepository: new PrismaProductVariantRepository(prisma),
    inventoryRepository: new PrismaInventoryRepository(prisma),
    transactionRunner: new PrismaTransactionRunner(prisma),
    auditWriter: new AmbientAuditWriter({
      auditLogRepository: new PrismaAuditLogRepository(prisma),
      idGenerator,
      clock,
    }),
    clock,
    logger,
  };
};

/** The four media-route use cases (S2-6a), split out for the same line-budget reason as the builder below. */
const buildVendorProductMediaController = (
  shared: VendorProductShared,
  objectStore: ObjectStore,
  idGenerator: IdGenerator,
  productMediaProcessingQueue: ProductMediaProcessingQueue,
): ReturnType<typeof createVendorProductMediaController> => {
  const {
    productRepository,
    productMediaRepository,
    transactionRunner,
    auditWriter,
    clock,
    logger,
  } = shared;
  return createVendorProductMediaController({
    createProductMediaUploadIntentUseCase: new CreateProductMediaUploadIntentUseCase({
      productRepository,
      productMediaRepository,
      objectStore,
      transactionRunner,
      idGenerator,
      clock,
      logger,
    }),
    completeProductMediaUploadUseCase: new CompleteProductMediaUploadUseCase({
      productRepository,
      productMediaRepository,
      objectStore,
      transactionRunner,
      auditWriter,
      // S2-6b: enqueued *after* the transaction commits, never inside it.
      productMediaProcessingQueue,
      clock,
      logger,
    }),
    listProductMediaUseCase: new ListProductMediaUseCase({
      productRepository,
      productMediaRepository,
    }),
    removeProductMediaUseCase: new RemoveProductMediaUseCase({
      productRepository,
      productMediaRepository,
      transactionRunner,
      auditWriter,
      clock,
      logger,
    }),
  });
};

const buildVendorProductRouter = (params: {
  prisma: PrismaClient;
  env: Env;
  bullRedis: Redis;
  categoryRepository: CategoryRepository;
  accessTokenService: AccessTokenService;
  sessionDenylist: SessionDenylist;
  resolveVendorTenant: VendorTenantResolver;
  idGenerator: IdGenerator;
  clock: Clock;
  logger: Logger;
}): Router => {
  const { categoryRepository, idGenerator, clock, logger } = params;
  const shared = buildVendorProductShared(params);
  const { productRepository, productVariantRepository, inventoryRepository } = shared;
  const productMediaObjectStore = buildProductMediaObjectStore(params.env);

  return createVendorProductRouter({
    controller: createVendorProductController({
      // The category a product write checks is a *platform* read, so it uses
      // the same non-tenant-scoped repository the public surface does.
      createProductUseCase: new CreateProductUseCase({
        ...shared,
        categoryRepository,
        idGenerator,
      }),
      updateProductUseCase: new UpdateProductUseCase({ ...shared, categoryRepository }),
      getProductUseCase: new GetProductUseCase({ productRepository }),
      listProductsUseCase: new ListProductsUseCase({ productRepository }),
      deleteProductUseCase: new DeleteProductUseCase(shared),
      submitProductForReviewUseCase: new SubmitProductForReviewUseCase({
        ...shared,
        categoryRepository,
      }),
    }),
    variants: createVendorProductVariantController({
      addProductVariantUseCase: new AddProductVariantUseCase({ ...shared, idGenerator }),
      updateProductVariantUseCase: new UpdateProductVariantUseCase(shared),
      getProductVariantUseCase: new GetProductVariantUseCase({ productVariantRepository }),
      listProductVariantsUseCase: new ListProductVariantsUseCase({
        productRepository,
        productVariantRepository,
      }),
      removeProductVariantUseCase: new RemoveProductVariantUseCase(shared),
    }),
    media: buildVendorProductMediaController(
      shared,
      productMediaObjectStore,
      idGenerator,
      new BullMqProductMediaProcessingQueue(params.bullRedis),
    ),
    inventory: buildVendorInventoryController({
      inventoryRepository,
      transactionRunner: shared.transactionRunner,
      auditWriter: shared.auditWriter,
      clock,
      logger,
    }),
    accessTokenService: params.accessTokenService,
    sessionDenylist: params.sessionDenylist,
    resolveVendorTenant: params.resolveVendorTenant,
  });
};

/** The admin taxonomy controllers, split out for the same line-budget reason as the two builders above. */
const buildAdminCategoryRouter = (params: {
  adminPrisma: PrismaClient;
  accessTokenService: AccessTokenService;
  sessionDenylist: SessionDenylist;
  idGenerator: IdGenerator;
  clock: Clock;
  logger: Logger;
}): Router => {
  const { adminPrisma, idGenerator, clock, logger } = params;
  const categoryRepository = new PrismaCategoryRepository(adminPrisma);
  const categoryAttributeRepository = new PrismaCategoryAttributeRepository(adminPrisma);
  const transactionRunner = new AdminTransactionRunner(adminPrisma);
  // Built on the same client as the repositories and the runner, so an audit
  // write joins the very transaction the category write is in (SDD 18.4 via
  // KYC-6's precedent).
  const auditWriter = new AmbientAuditWriter({
    auditLogRepository: new PrismaAuditLogRepository(adminPrisma),
    idGenerator,
    clock,
  });
  const shared = { categoryRepository, transactionRunner, auditWriter, clock, logger };
  const attributeShared = {
    categoryAttributeRepository,
    transactionRunner,
    auditWriter,
    clock,
    logger,
  };

  return createAdminCategoryRouter(
    createAdminCategoryController({
      createCategoryUseCase: new CreateCategoryUseCase({ ...shared, idGenerator }),
      updateCategoryUseCase: new UpdateCategoryUseCase(shared),
      reparentCategoryUseCase: new ReparentCategoryUseCase(shared),
      // Deleting a category takes its own attribute definitions with it, in the
      // same transaction — which is why this one use case needs both repositories.
      deleteCategoryUseCase: new DeleteCategoryUseCase({ ...shared, categoryAttributeRepository }),
      getCategoryUseCase: new GetCategoryUseCase({ categoryRepository }),
      listCategoriesUseCase: new ListCategoriesUseCase({ categoryRepository }),
    }),
    createAdminCategoryAttributeController({
      addCategoryAttributeUseCase: new AddCategoryAttributeUseCase({
        ...attributeShared,
        categoryRepository,
        idGenerator,
      }),
      updateCategoryAttributeUseCase: new UpdateCategoryAttributeUseCase(attributeShared),
      removeCategoryAttributeUseCase: new RemoveCategoryAttributeUseCase(attributeShared),
      getCategoryAttributeUseCase: new GetCategoryAttributeUseCase({ categoryAttributeRepository }),
      listCategoryAttributesUseCase: new ListCategoryAttributesUseCase({
        categoryRepository,
        categoryAttributeRepository,
      }),
    }),
    params.accessTokenService,
    params.sessionDenylist,
  );
};

/**
 * The admin product moderation surface (S2-5), built on `adminPrisma` —
 * mirrors `buildAdminKycRouter` in `vendor.module.ts` exactly: the queue and
 * detail reads use a dedicated cross-tenant query port
 * (`PrismaProductReviewQuery`), and the decision runs through the same
 * `ProductRepository` port the vendor-facing surface uses, just bound to the
 * elevated credential and the admin transaction runner instead.
 *
 * `Product` is in `TENANT_SCOPED_MODELS`, but `adminPrisma` is never wrapped
 * by `withTenantBoundary` — the extension only guards the ordinary `prisma`
 * client — so `PrismaProductRepository` built on it needs no tenant context,
 * the same reason `PrismaVendorKycRepository` is reused for both the
 * vendor-facing and admin paths in `vendor.module.ts`.
 */
const buildAdminProductRouter = (params: {
  adminPrisma: PrismaClient;
  accessTokenService: AccessTokenService;
  sessionDenylist: SessionDenylist;
  idGenerator: IdGenerator;
  clock: Clock;
  logger: Logger;
}): Router => {
  const { adminPrisma, idGenerator, clock, logger } = params;
  const productReviewQuery = new PrismaProductReviewQuery(adminPrisma);
  const productRepository = new PrismaProductRepository(adminPrisma);
  // The admin runner, not `PrismaTransactionRunner`: that one opens a tenant
  // transaction and refuses without a tenant context, which this router
  // deliberately never establishes.
  const transactionRunner = new AdminTransactionRunner(adminPrisma);
  // Built on `adminPrisma` too, so the audit write joins the same transaction
  // as the decision it records.
  const auditWriter = new AmbientAuditWriter({
    auditLogRepository: new PrismaAuditLogRepository(adminPrisma),
    idGenerator,
    clock,
  });

  return createAdminProductRouter(
    createAdminProductController({
      listProductReviewQueueUseCase: new ListProductReviewQueueUseCase({
        productReviewQuery,
        logger,
      }),
      getProductReviewUseCase: new GetProductReviewUseCase({ productReviewQuery, logger }),
      decideProductUseCase: new DecideProductUseCase({
        productRepository,
        transactionRunner,
        auditWriter,
        clock,
        logger,
      }),
    }),
    params.accessTokenService,
    params.sessionDenylist,
  );
};

/**
 * The public search surface (S2-7), built on `publicPrisma`. `optionalAuthenticate`
 * and the two-tier limiter both need the identity module's token verifier
 * and denylist, the exact pair `vendorProductRouter`'s `authenticate` already
 * threads through — reused here, not re-derived.
 */
const buildPublicSearchRouter = (params: {
  publicPrisma: PrismaClient;
  redis: Redis;
  env: Env;
  accessTokenService: AccessTokenService;
  sessionDenylist: SessionDenylist;
  logger: Logger;
}): Router => {
  const productSearchQuery = new PrismaProductSearchQuery(params.publicPrisma);
  return createPublicSearchRouter({
    controller: createPublicSearchController({
      searchProductsUseCase: new SearchProductsUseCase({
        productSearchQuery,
        logger: params.logger,
      }),
    }),
    accessTokenService: params.accessTokenService,
    sessionDenylist: params.sessionDenylist,
    redis: params.redis,
    env: params.env,
  });
};

/**
 * The catalogue module (SDD 5, module 4): taxonomy, vendor products, the
 * moderation core (S2-5), the product media data model/upload flow (S2-6a)
 * and the public search surface (S2-7). The async processing worker (S2-6b)
 * lives in its own process; public media delivery (S2-6c) is still a later
 * chunk, and nothing here anticipates it.
 *
 * Five routers, and the credential each runs on is the whole security story.
 * `adminCategoryRouter` uses `adminPrisma` for the admin-owned taxonomy.
 * `publicCategoryRouter` (S2-2c) uses the ordinary `prisma` for the
 * unauthenticated public tree — same tables, same `CategoryRepository` port
 * and adapter class, different client, never a second implementation.
 * `vendorProductRouter` (S2-3b/S2-5) uses that same ordinary `prisma`, but for
 * models that *are* tenant-scoped, so the client refuses a query issued
 * without a tenant context and RLS refuses one aimed at another vendor.
 * `adminProductRouter` (S2-5) uses `adminPrisma` again, this time for the
 * cross-tenant moderation queue and decision, the same split
 * `adminKycRouter`/vendor-facing `router` draw in `vendor.module.ts`.
 * `publicSearchRouter` (S2-7) uses neither — its own fourth credential,
 * `publicPrisma`, whose RLS policy is what makes it safe for an anonymous
 * caller to read a tenant-scoped table at all.
 */
export const createCatalogueModule = (deps: CatalogueModuleDeps): CatalogueModule => {
  const {
    adminPrisma,
    prisma,
    publicPrisma,
    env,
    redis,
    accessTokenService,
    sessionDenylist,
    resolveVendorTenant,
    idGenerator,
    clock,
    logger,
  } = deps;
  const moduleLogger = logger.child({ module: 'catalogue' });

  // The public and vendor surfaces both read categories on the ordinary
  // client; the admin builder makes its own on `adminPrisma`.
  const publicCategoryRepository = new PrismaCategoryRepository(prisma);

  const vendorProductRouter = buildVendorProductRouter({
    prisma,
    env,
    bullRedis: deps.bullRedis,
    categoryRepository: publicCategoryRepository,
    accessTokenService,
    sessionDenylist,
    resolveVendorTenant,
    idGenerator,
    clock,
    logger: moduleLogger,
  });

  return {
    publicSearchRouter: buildPublicSearchRouter({
      publicPrisma,
      redis,
      env,
      accessTokenService,
      sessionDenylist,
      logger: moduleLogger,
    }),
    adminCategoryRouter: buildAdminCategoryRouter({
      adminPrisma,
      accessTokenService,
      sessionDenylist,
      idGenerator,
      clock,
      logger: moduleLogger,
    }),
    publicCategoryRouter: createPublicCategoryRouter(
      buildPublicCategoryController(publicCategoryRepository),
    ),
    vendorProductRouter,
    adminProductRouter: buildAdminProductRouter({
      adminPrisma,
      accessTokenService,
      sessionDenylist,
      idGenerator,
      clock,
      logger: moduleLogger,
    }),
  };
};
