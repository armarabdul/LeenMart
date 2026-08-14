import type { PrismaClient } from '@prisma/client';
import type { Router } from 'express';
import type { Clock, IdGenerator } from '@leen-mart/domain-kit';
import type { AccessTokenService, SessionDenylist } from '../identity/index.js';
import { PrismaInventoryRepository } from '../catalogue/infrastructure/persistence/prisma-inventory.repository.js';
import { PrismaProductVariantRepository } from '../catalogue/infrastructure/persistence/prisma-product-variant.repository.js';
import { PrismaCartRepository } from './infrastructure/persistence/prisma-cart.repository.js';
import { PrismaCartItemRepository } from './infrastructure/persistence/prisma-cart-item.repository.js';
import { GetCartUseCase } from './application/use-cases/get-cart.use-case.js';
import { AddCartItemUseCase } from './application/use-cases/add-cart-item.use-case.js';
import { UpdateCartItemQuantityUseCase } from './application/use-cases/update-cart-item-quantity.use-case.js';
import { RemoveCartItemUseCase } from './application/use-cases/remove-cart-item.use-case.js';
import { ClearCartUseCase } from './application/use-cases/clear-cart.use-case.js';
import { createCartController } from './interface/http/cart.controller.js';
import { createCartRouter } from './interface/http/cart.routes.js';

export interface CartModuleDeps {
  /** Plain, non-RLS client — `carts`/`cart_items` are outside `TENANT_SCOPED_MODELS`, same as `addresses`. */
  readonly prisma: PrismaClient;
  /**
   * The `leenmart_public` credential (S2-7), reused here for exactly the
   * same reason it exists: a customer session has no vendor tenant, so
   * eligibility/availability reads against catalogue's tenant-scoped tables
   * must go through the one client whose RLS confines them to `APPROVED`,
   * non-deleted rows regardless of vendor — never `adminPrisma`, which would
   * be a genuine privilege escalation for a customer-triggered action.
   */
  readonly publicPrisma: PrismaClient;
  readonly accessTokenService: AccessTokenService;
  readonly sessionDenylist: SessionDenylist;
  readonly clock: Clock;
  readonly idGenerator: IdGenerator;
}

export interface CartModule {
  readonly router: Router;
}

/**
 * This module's own composition root (SDD 2.3), mirroring
 * `createCustomerModule`. `catalogue`'s Prisma repository classes are
 * imported directly from its `infrastructure/persistence/*` path rather than
 * through `catalogue/index.ts` — the same precedent `vendor.module.ts`
 * already sets by importing `PrismaUserRepository` directly from
 * `identity/infrastructure/persistence/...`. Bound to `publicPrisma` instead
 * of the tenant client, they need no new code in `catalogue` at all.
 */
export const createCartModule = (deps: CartModuleDeps): CartModule => {
  const { prisma, publicPrisma, accessTokenService, sessionDenylist, clock, idGenerator } = deps;

  const cartRepository = new PrismaCartRepository(prisma);
  const cartItemRepository = new PrismaCartItemRepository(prisma);
  const productVariantRepository = new PrismaProductVariantRepository(publicPrisma);
  const inventoryRepository = new PrismaInventoryRepository(publicPrisma);

  const getCartUseCase = new GetCartUseCase({ cartRepository, cartItemRepository });
  const addCartItemUseCase = new AddCartItemUseCase({
    cartRepository,
    cartItemRepository,
    productVariantRepository,
    inventoryRepository,
    idGenerator,
    clock,
  });
  const updateCartItemQuantityUseCase = new UpdateCartItemQuantityUseCase({
    cartRepository,
    cartItemRepository,
    productVariantRepository,
    inventoryRepository,
    clock,
  });
  const removeCartItemUseCase = new RemoveCartItemUseCase({
    cartRepository,
    cartItemRepository,
    clock,
  });
  const clearCartUseCase = new ClearCartUseCase({ cartRepository, cartItemRepository, clock });

  const controller = createCartController({
    getCartUseCase,
    addCartItemUseCase,
    updateCartItemQuantityUseCase,
    removeCartItemUseCase,
    clearCartUseCase,
  });
  const router = createCartRouter(controller, accessTokenService, sessionDenylist);

  return { router };
};
