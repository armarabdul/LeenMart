import { Router } from 'express';
import { z } from 'zod';
import {
  addCartItemRequestSchema,
  updateCartItemRequestSchema,
  uuidSchema,
} from '@leen-mart/contracts';
import { asyncHandler } from '../../../../shared/interface/http/middleware/async-handler.js';
import { authenticate } from '../../../../shared/interface/http/middleware/authenticate.js';
import { validate } from '../../../../shared/interface/http/middleware/validate.js';
import type { AccessTokenService, SessionDenylist } from '../../../identity/index.js';
import type { CartController } from './cart.controller.js';

const cartItemParamsSchema = z.object({ itemId: uuidSchema }).strict();

/**
 * Mounted at `/api/v1/me` (matching `addresses` — SDD 9.4's own summary
 * table names `/api/v1/cart` for this surface, but that table is a coarse
 * summary that doesn't even list `/api/v1/me/addresses`, the real, shipped
 * convention for customer-owned resources; this follows the latter). Every
 * route here requires `authenticate()` and always scopes to the resulting
 * `principal.userId`, never a client-supplied one.
 */
export const createCartRouter = (
  controller: CartController,
  accessTokenService: AccessTokenService,
  sessionDenylist: SessionDenylist,
): Router => {
  const router = Router();
  const requireAuth = authenticate(accessTokenService, sessionDenylist);

  router.get('/cart', requireAuth, asyncHandler(controller.getCart));
  router.post(
    '/cart/items',
    requireAuth,
    validate({ body: addCartItemRequestSchema }),
    asyncHandler(controller.addItem),
  );
  router.patch(
    '/cart/items/:itemId',
    requireAuth,
    validate({ params: cartItemParamsSchema, body: updateCartItemRequestSchema }),
    asyncHandler(controller.updateItemQuantity),
  );
  router.delete(
    '/cart/items/:itemId',
    requireAuth,
    validate({ params: cartItemParamsSchema }),
    asyncHandler(controller.removeItem),
  );
  router.delete('/cart', requireAuth, asyncHandler(controller.clearCart));

  return router;
};
