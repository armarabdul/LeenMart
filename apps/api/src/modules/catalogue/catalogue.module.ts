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
import { PrismaCategoryRepository } from './infrastructure/persistence/prisma-category.repository.js';
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

  const controller = createAdminCategoryController({
    createCategoryUseCase: new CreateCategoryUseCase({ ...shared, idGenerator }),
    updateCategoryUseCase: new UpdateCategoryUseCase(shared),
    reparentCategoryUseCase: new ReparentCategoryUseCase(shared),
    deleteCategoryUseCase: new DeleteCategoryUseCase(shared),
    getCategoryUseCase: new GetCategoryUseCase({ categoryRepository }),
    listCategoriesUseCase: new ListCategoriesUseCase({ categoryRepository }),
  });

  return {
    adminCategoryRouter: createAdminCategoryRouter(controller, accessTokenService, sessionDenylist),
  };
};
