import type { PrismaClient } from '@prisma/client';
import type { Router } from 'express';
import type { Clock, IdGenerator, Logger } from '@leen-mart/domain-kit';
import type { AccessTokenService } from '../identity/index.js';
import { PrismaVendorRepository } from './infrastructure/persistence/prisma-vendor.repository.js';
import { RegisterVendorUseCase } from './application/use-cases/register-vendor.use-case.js';
import { createVendorController } from './interface/http/vendor.controller.js';
import { createVendorRouter } from './interface/http/vendor.routes.js';

export interface VendorModuleDeps {
  readonly prisma: PrismaClient;
  /**
   * Verifies the caller's access token. Injected rather than constructed
   * here: SDD 5 makes `identity` the sole owner of tokens, so this module
   * consumes the one instance the composition root already has instead of
   * minting a second signer.
   */
  readonly accessTokenService: AccessTokenService;
  readonly clock: Clock;
  readonly idGenerator: IdGenerator;
  readonly logger: Logger;
}

export interface VendorModule {
  readonly router: Router;
}

/**
 * This module's own composition root (SDD 2.3), mirroring
 * `createIdentityModule`: `app.ts` knows nothing about Prisma or the vendor
 * lifecycle — it hands over the shared container's ports and gets a router.
 */
export const createVendorModule = (deps: VendorModuleDeps): VendorModule => {
  const { prisma, accessTokenService, clock, idGenerator, logger } = deps;
  const moduleLogger = logger.child({ module: 'vendor' });

  const vendorRepository = new PrismaVendorRepository(prisma);

  const registerVendorUseCase = new RegisterVendorUseCase({
    vendorRepository,
    idGenerator,
    clock,
    logger: moduleLogger,
  });

  const controller = createVendorController({ registerVendorUseCase });
  const router = createVendorRouter(controller, accessTokenService);
  return { router };
};
