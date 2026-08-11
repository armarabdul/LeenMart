import type { PrismaClient } from '@prisma/client';
import type { Router } from 'express';
import type { Clock, IdGenerator, Logger } from '@leen-mart/domain-kit';
import type { AccessTokenService, SessionDenylist } from '../identity/index.js';
import { PrismaAddressRepository } from './infrastructure/persistence/prisma-address.repository.js';
import { AddAddressUseCase } from './application/use-cases/add-address.use-case.js';
import { ListAddressesUseCase } from './application/use-cases/list-addresses.use-case.js';
import { UpdateAddressUseCase } from './application/use-cases/update-address.use-case.js';
import { RemoveAddressUseCase } from './application/use-cases/remove-address.use-case.js';
import { SetDefaultAddressUseCase } from './application/use-cases/set-default-address.use-case.js';
import { createAddressController } from './interface/http/address.controller.js';
import { createAddressRouter } from './interface/http/address.routes.js';

export interface CustomerModuleDeps {
  readonly prisma: PrismaClient;
  /**
   * Verifies the caller's access token. Injected rather than constructed
   * here: SDD 5 makes `identity` the sole owner of tokens, so this module
   * consumes the one instance the composition root already has instead of
   * minting a second signer.
   */
  readonly accessTokenService: AccessTokenService;
  /**
   * The one shared denylist (SDD 7.2). Injected for the same reason
   * `accessTokenService` is: a session revoked at logout must stop
   * authenticating on *this* module's routes too, which only holds if every
   * module consults the same instance.
   */
  readonly sessionDenylist: SessionDenylist;
  readonly clock: Clock;
  readonly idGenerator: IdGenerator;
  readonly logger: Logger;
}

export interface CustomerModule {
  readonly router: Router;
}

/**
 * This module's own composition root (SDD 2.3), mirroring
 * `createVendorModule`: `app.ts` knows nothing about Prisma or the address
 * book — it hands over the shared container's ports and gets back a router.
 */
export const createCustomerModule = (deps: CustomerModuleDeps): CustomerModule => {
  const { prisma, accessTokenService, sessionDenylist, clock, idGenerator, logger } = deps;
  const moduleLogger = logger.child({ module: 'customer' });

  const addressRepository = new PrismaAddressRepository(prisma);

  const addAddressUseCase = new AddAddressUseCase({
    addressRepository,
    idGenerator,
    clock,
    logger: moduleLogger,
  });
  const listAddressesUseCase = new ListAddressesUseCase({ addressRepository });
  const updateAddressUseCase = new UpdateAddressUseCase({
    addressRepository,
    clock,
    logger: moduleLogger,
  });
  const removeAddressUseCase = new RemoveAddressUseCase({
    addressRepository,
    clock,
    logger: moduleLogger,
  });
  const setDefaultAddressUseCase = new SetDefaultAddressUseCase({
    addressRepository,
    clock,
    logger: moduleLogger,
  });

  const controller = createAddressController({
    addAddressUseCase,
    listAddressesUseCase,
    updateAddressUseCase,
    removeAddressUseCase,
    setDefaultAddressUseCase,
  });
  const router = createAddressRouter(controller, accessTokenService, sessionDenylist);
  return { router };
};
