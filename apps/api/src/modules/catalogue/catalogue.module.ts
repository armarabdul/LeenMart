import type { PrismaClient } from '@prisma/client';
import type { Router } from 'express';
import type { Clock, IdGenerator, Logger } from '@leen-mart/domain-kit';
import { AmbientAuditWriter } from '../audit/index.js';
import { PrismaAuditLogRepository } from '../audit/infrastructure/persistence/prisma-audit-log.repository.js';
import type { AccessTokenService, SessionDenylist } from '../identity/index.js';
import { AdminTransactionRunner } from '../../shared/infrastructure/persistence/tenant-prisma.js';
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
  readonly accessTokenService: AccessTokenService;
  readonly sessionDenylist: SessionDenylist;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
  readonly logger: Logger;
}

export interface CatalogueModule {
  readonly adminCategoryRouter: Router;
  readonly publicCategoryRouter: Router;
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
 * The catalogue module (SDD 5, module 4) — taxonomy only, at this milestone.
 *
 * Products, variants, media, inventory, moderation and search are later
 * chunks; nothing here anticipates them, and no table beyond `categories` and
 * `category_attributes` exists yet.
 *
 * Two routers, two credentials: `adminCategoryRouter` runs on `adminPrisma`
 * for the admin-owned taxonomy surface; `publicCategoryRouter` (S2-2c) runs on
 * the ordinary `prisma` for the unauthenticated public tree/detail surface.
 * Same tables, same `CategoryRepository` port and adapter class, different
 * client — never a second repository implementation.
 */
export const createCatalogueModule = (deps: CatalogueModuleDeps): CatalogueModule => {
  const { adminPrisma, prisma, accessTokenService, sessionDenylist, idGenerator, clock, logger } =
    deps;
  const moduleLogger = logger.child({ module: 'catalogue' });

  const categoryRepository = new PrismaCategoryRepository(adminPrisma);
  const categoryAttributeRepository = new PrismaCategoryAttributeRepository(adminPrisma);
  const publicCategoryRepository = new PrismaCategoryRepository(prisma);
  const transactionRunner = new AdminTransactionRunner(adminPrisma);
  // Built on the same client as the repository and the runner, so an audit
  // write joins the very transaction the category write is in (SDD 18.4 via
  // KYC-6's precedent).
  const auditWriter = new AmbientAuditWriter({
    auditLogRepository: new PrismaAuditLogRepository(adminPrisma),
    idGenerator,
    clock,
  });

  const shared = {
    categoryRepository,
    transactionRunner,
    auditWriter,
    clock,
    logger: moduleLogger,
  };
  const attributeShared = {
    categoryAttributeRepository,
    transactionRunner,
    auditWriter,
    clock,
    logger: moduleLogger,
  };

  const controller = createAdminCategoryController({
    createCategoryUseCase: new CreateCategoryUseCase({ ...shared, idGenerator }),
    updateCategoryUseCase: new UpdateCategoryUseCase(shared),
    reparentCategoryUseCase: new ReparentCategoryUseCase(shared),
    // Deleting a category takes its own attribute definitions with it, in the
    // same transaction — which is why this one use case needs both repositories.
    deleteCategoryUseCase: new DeleteCategoryUseCase({ ...shared, categoryAttributeRepository }),
    getCategoryUseCase: new GetCategoryUseCase({ categoryRepository }),
    listCategoriesUseCase: new ListCategoriesUseCase({ categoryRepository }),
  });

  const attributeController = createAdminCategoryAttributeController({
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
  });

  const publicController = buildPublicCategoryController(publicCategoryRepository);

  return {
    adminCategoryRouter: createAdminCategoryRouter(
      controller,
      attributeController,
      accessTokenService,
      sessionDenylist,
    ),
    publicCategoryRouter: createPublicCategoryRouter(publicController),
  };
};
