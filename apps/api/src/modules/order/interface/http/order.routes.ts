import { Router } from 'express';
import { z } from 'zod';
import { placeOrderRequestSchema } from '@leen-mart/contracts';
import type { Clock, IdGenerator } from '@leen-mart/domain-kit';
import { asyncHandler } from '../../../../shared/interface/http/middleware/async-handler.js';
import { authenticate } from '../../../../shared/interface/http/middleware/authenticate.js';
import { requirePermission } from '../../../../shared/interface/http/middleware/authorize.js';
import { idempotency } from '../../../../shared/interface/http/middleware/idempotency.js';
import { validate } from '../../../../shared/interface/http/middleware/validate.js';
import type { IdempotencyKeyRepository } from '../../../../shared/infrastructure/persistence/idempotency-key.repository.js';
import type { AccessTokenService, SessionDenylist } from '../../../identity/index.js';
import type { OrderController } from './order.controller.js';

const orderIdParamsSchema = z.object({ id: z.string().uuid() }).strict();

/** The fixed idempotency scope key for this one route — see `idempotency()`'s own doc comment for why this is a plain string, not derived from the request path. */
const PLACE_ORDER_ENDPOINT = 'POST /api/v1/orders';

/**
 * Mounted at `/api/v1/orders` (SDD 9.2). Every route here is
 * `requirePermission`'s intended first production consumer for
 * `PLACE_ORDER`/`VIEW_OWN_ORDERS`/`CANCEL_OWN_ORDER` — SDD 8.2 permissions
 * that existed since Stage 1 with no route until this milestone (the same
 * "designed for, not yet wired" shape `vendor.routes.ts`'s
 * `MANAGE_SHOP_PROFILE` route is).
 *
 * Ordering is SDD 7.4's three questions in sequence on every route:
 * `authenticate` ("who is this?"), `requirePermission` ("may this role do
 * this at all?" — `CUSTOMER` is the only role holding `FULL`/`OWN` on any
 * of these three), then validation. Step 3 ("may *this* principal act on
 * *this* object?") stays in the use case, which scopes every read/write by
 * `principal.userId` and never accepts a customer id from the request.
 */
export interface OrderRouterDeps {
  readonly accessTokenService: AccessTokenService;
  readonly sessionDenylist: SessionDenylist;
  readonly idempotencyKeyRepository: IdempotencyKeyRepository;
  readonly clock: Clock;
  readonly idGenerator: IdGenerator;
}

export const createOrderRouter = (controller: OrderController, deps: OrderRouterDeps): Router => {
  const { accessTokenService, sessionDenylist, idempotencyKeyRepository, clock, idGenerator } =
    deps;
  const router = Router();

  router.post(
    '/',
    authenticate(accessTokenService, sessionDenylist),
    requirePermission('PLACE_ORDER'),
    validate({ body: placeOrderRequestSchema }),
    idempotency(idempotencyKeyRepository, PLACE_ORDER_ENDPOINT, { clock, idGenerator }),
    asyncHandler(controller.placeOrder),
  );

  router.get(
    '/:id',
    authenticate(accessTokenService, sessionDenylist),
    requirePermission('VIEW_OWN_ORDERS'),
    validate({ params: orderIdParamsSchema }),
    asyncHandler(controller.getOrder),
  );

  router.post(
    '/:id/cancel',
    authenticate(accessTokenService, sessionDenylist),
    requirePermission('CANCEL_OWN_ORDER'),
    validate({ params: orderIdParamsSchema }),
    asyncHandler(controller.cancelOrder),
  );

  return router;
};
