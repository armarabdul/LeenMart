import { Router } from 'express';
import { z } from 'zod';
import {
  confirmPaymentRequestSchema,
  placeOrderRequestSchema,
  slotAvailabilityQuerySchema,
} from '@leen-mart/contracts';
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
const pickupTokenParamsSchema = z
  .object({ id: z.string().uuid(), subOrderId: z.string().uuid() })
  .strict();

/** The fixed idempotency scope key for this one route — see `idempotency()`'s own doc comment for why this is a plain string, not derived from the request path. */
const PLACE_ORDER_ENDPOINT = 'POST /api/v1/orders';
/** S3-3B: same reasoning, one fixed scope string per route — never derived from `:id`, so the key's own uniqueness is what disambiguates one caller's repeated calls from another's. */
const INITIATE_PAYMENT_ENDPOINT = 'POST /api/v1/orders/:id/payment/initiate';
const CONFIRM_PAYMENT_ENDPOINT = 'POST /api/v1/orders/:id/payment/confirm';

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

/**
 * The two payment steps (S3-3B). Split into their own mount function to keep
 * `createOrderRouter` inside this repository's function-length budget once
 * S4-SLOTS added a fourth read — the same shape `vendor.routes.ts` already
 * uses. The middleware order is identical to every route beside them.
 */
const mountPaymentRoutes = (
  router: Router,
  controller: OrderController,
  deps: OrderRouterDeps,
): void => {
  const { accessTokenService, sessionDenylist, idempotencyKeyRepository, clock, idGenerator } =
    deps;
  // S3-3B: `PLACE_ORDER`, not a new permission. SDD 4.2's own approved order-
  // placement flow already folds "create the provider-side payment order"
  // into `PlaceOrderUseCase`'s own steps (4g), under the same permission —
  // splitting checkout into "place" then "pay" here is a shape difference
  // from a mock/synchronous adapter having no webhook to drive confirmation,
  // not a different capability needing its own row in SDD 8.2's matrix.
  // Ownership (this order belongs to the caller) is still the use case's
  // job, exactly like every other route in this file.
  router.post(
    '/:id/payment/initiate',
    authenticate(accessTokenService, sessionDenylist),
    requirePermission('PLACE_ORDER'),
    validate({ params: orderIdParamsSchema }),
    idempotency(idempotencyKeyRepository, INITIATE_PAYMENT_ENDPOINT, { clock, idGenerator }),
    asyncHandler(controller.initiatePayment),
  );

  router.post(
    '/:id/payment/confirm',
    authenticate(accessTokenService, sessionDenylist),
    requirePermission('PLACE_ORDER'),
    validate({ params: orderIdParamsSchema, body: confirmPaymentRequestSchema }),
    idempotency(idempotencyKeyRepository, CONFIRM_PAYMENT_ENDPOINT, { clock, idGenerator }),
    asyncHandler(controller.confirmPayment),
  );
};

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

  // S4-SLOTS: what the caller may choose at their own checkout. Registered
  // before `GET /:id` so the literal path is matched as itself rather than
  // being offered to the id route's uuid validation.
  //
  // `PLACE_ORDER`, not a new permission: this is checkout information, and
  // SDD 8.2 has no separate row for reading it.
  router.get(
    '/slot-availability',
    authenticate(accessTokenService, sessionDenylist),
    requirePermission('PLACE_ORDER'),
    validate({ query: slotAvailabilityQuerySchema }),
    asyncHandler(controller.getSlotAvailability),
  );

  // S3-4: "My Orders" — no params to validate, the same shape `GET /me/cart`
  // already uses for a no-resource-id read. Mounted before `GET /:id` for
  // readability; Express treats `/` and `/:id` as distinct patterns, so
  // there is no ordering ambiguity between the two.
  router.get(
    '/',
    authenticate(accessTokenService, sessionDenylist),
    requirePermission('VIEW_OWN_ORDERS'),
    asyncHandler(controller.listOrders),
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

  // S4-QR: the customer's own QR/token view — `VIEW_OWN_ORDERS`, no new
  // permission (the pickup-mode analogue of reading the order's own
  // status). No idempotency wrapper: this is a read that also rotates the
  // token as a side effect (the use case's own doc comment explains why
  // that is safe to repeat), not a create.
  router.get(
    '/:id/sub-orders/:subOrderId/pickup-token',
    authenticate(accessTokenService, sessionDenylist),
    requirePermission('VIEW_OWN_ORDERS'),
    validate({ params: pickupTokenParamsSchema }),
    asyncHandler(controller.getPickupToken),
  );

  mountPaymentRoutes(router, controller, deps);

  return router;
};
