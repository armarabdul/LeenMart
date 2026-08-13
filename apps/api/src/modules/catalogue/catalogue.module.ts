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
import { ListCategoryAttributesUseCase } from './application/use-cases/list-category-attributes.use-case.js';
import { RemoveCategoryAttributeUseCase } from './application/use-cases/remove-category-attribute.use-case.js';
import { UpdateCategoryAttributeUseCase } from './application/use-cases/update-category-attribute.use-case.js';
import { PrismaCategoryAttributeRepository } from './infrastructure/persistence/prisma-category-attribute.repository.js';
import { PrismaCategoryRepository } from './infrastructure/persistence/prisma-category.repository.js';
import { createAdminCategoryAttributeController } from './interface/http/admin-category-attribute.controller.js';
import { createAdminCategoryController } from './interface/http/admin-category.controller.js';
import { createAdminCategoryRouter } from './interface/http/admin-category.routes.js';

export interface CatalogueModuleDeps {
  /**
   * The elevated credential. Categories carry no tenant column and no RLS
   * policy, so this is not about bypassing isolation — it is that the taxonomy
   * is an admin-owned surface, and building it on the same credential the rest
   * of the admin console uses keeps one story about which role writes what.
   */
  readonly adminPrisma: PrismaClient;
  readonly accessTokenService: AccessTokenService;
  readonly sessionDenylist: SessionDenylist;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
  readonly logger: Logger;
}

export interface CatalogueModule {
  readonly adminCategoryRouter: Router;
}

/**
 * The catalogue module (SDD 5, module 4) — taxonomy only, at this milestone.
 *
 * Products, variants, media, inventory, moderation and search are later
 * chunks; nothing here anticipates them, and no table beyond `categories`
 * exists yet.
 *
 * No public router: the public category tree is its own milestone, and adding
 * an empty one now would be a route with no behaviour to test.
 */
export const createCatalogueModule = (deps: CatalogueModuleDeps): CatalogueModule => {
  const { adminPrisma, accessTokenService, sessionDenylist, idGenerator, clock, logger } = deps;
  const moduleLogger = logger.child({ module: 'catalogue' });

  const categoryRepository = new PrismaCategoryRepository(adminPrisma);
  const categoryAttributeRepository = new PrismaCategoryAttributeRepository(adminPrisma);
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

  return {
    adminCategoryRouter: createAdminCategoryRouter(
      controller,
      attributeController,
      accessTokenService,
      sessionDenylist,
    ),
  };
};
