import { Router } from 'express';
import { z } from 'zod';
import {
  confirmReservationPaymentRequestSchema,
  createReservationRequestSchema,
  cursorPaginationSchema,
} from '@leen-mart/contracts';
import type { Clock, IdGenerator } from '@leen-mart/domain-kit';
import { asyncHandler } from '../../../../shared/interface/http/middleware/async-handler.js';
import { authenticate } from '../../../../shared/interface/http/middleware/authenticate.js';
import { requirePermission } from '../../../../shared/interface/http/middleware/authorize.js';
import { idempotency } from '../../../../shared/interface/http/middleware/idempotency.js';
import { validate } from '../../../../shared/interface/http/middleware/validate.js';
import type { IdempotencyKeyRepository } from '../../../../shared/infrastructure/persistence/idempotency-key.repository.js';
import type { AccessTokenService, SessionDenylist } from '../../../identity/index.js';
import type { ReservationController } from './reservation.controller.js';

const reservationParamsSchema = z.object({ id: z.string().uuid() }).strict();

const CREATE_RESERVATION_ENDPOINT = 'POST /api/v1/preorder-reservations';
const INITIATE_ADVANCE_ENDPOINT = 'POST /api/v1/preorder-reservations/:id/advance-payment/initiate';
const CONFIRM_ADVANCE_ENDPOINT = 'POST /api/v1/preorder-reservations/:id/advance-payment/confirm';
const INITIATE_BALANCE_ENDPOINT = 'POST /api/v1/preorder-reservations/:id/balance-payment/initiate';
const CONFIRM_BALANCE_ENDPOINT = 'POST /api/v1/preorder-reservations/:id/balance-payment/confirm';

export interface ReservationRouterDeps {
  readonly accessTokenService: AccessTokenService;
  readonly sessionDenylist: SessionDenylist;
  readonly idempotencyKeyRepository: IdempotencyKeyRepository;
  readonly clock: Clock;
  readonly idGenerator: IdGenerator;
}

/**
 * The four payment steps (advance/balance × initiate/confirm) — split into
 * their own mount function purely to keep `createReservationRouter` within
 * this repository's function-length budget, the same shape
 * `order.routes.ts`'s own `mountPaymentRoutes` already uses.
 */
const mountPaymentRoutes = (
  router: Router,
  controller: ReservationController,
  deps: ReservationRouterDeps,
): void => {
  const { accessTokenService, sessionDenylist, idempotencyKeyRepository, clock, idGenerator } =
    deps;
  const authenticated = [authenticate(accessTokenService, sessionDenylist)];

  router.post(
    '/:id/advance-payment/initiate',
    ...authenticated,
    requirePermission('PLACE_ORDER'),
    validate({ params: reservationParamsSchema }),
    idempotency(idempotencyKeyRepository, INITIATE_ADVANCE_ENDPOINT, { clock, idGenerator }),
    asyncHandler(controller.initiateAdvancePayment),
  );

  router.post(
    '/:id/advance-payment/confirm',
    ...authenticated,
    requirePermission('PLACE_ORDER'),
    validate({ params: reservationParamsSchema, body: confirmReservationPaymentRequestSchema }),
    idempotency(idempotencyKeyRepository, CONFIRM_ADVANCE_ENDPOINT, { clock, idGenerator }),
    asyncHandler(controller.confirmAdvancePayment),
  );

  router.post(
    '/:id/balance-payment/initiate',
    ...authenticated,
    requirePermission('PLACE_ORDER'),
    validate({ params: reservationParamsSchema }),
    idempotency(idempotencyKeyRepository, INITIATE_BALANCE_ENDPOINT, { clock, idGenerator }),
    asyncHandler(controller.initiateBalancePayment),
  );

  router.post(
    '/:id/balance-payment/confirm',
    ...authenticated,
    requirePermission('PLACE_ORDER'),
    validate({ params: reservationParamsSchema, body: confirmReservationPaymentRequestSchema }),
    idempotency(idempotencyKeyRepository, CONFIRM_BALANCE_ENDPOINT, { clock, idGenerator }),
    asyncHandler(controller.confirmBalancePayment),
  );
};

/**
 * Mounted at `/api/v1/preorder-reservations` — a customer-owned, financial
 * surface, shaped like `/api/v1/orders` rather than `/api/v1/me/cart`
 * (locked reasoning: a reservation is a financial commitment against a
 * campaign, the same category of action `PLACE_ORDER`/`VIEW_OWN_ORDERS`/
 * `CANCEL_OWN_ORDER` already exist for — reused here rather than adding a
 * new permission, per the implementation brief's own instruction).
 *
 * Every mutating route carries the existing Idempotency-Key middleware
 * (`order.routes.ts`'s own precedent) — never a second idempotency
 * implementation.
 */
export const createReservationRouter = (
  controller: ReservationController,
  deps: ReservationRouterDeps,
): Router => {
  const { accessTokenService, sessionDenylist, idempotencyKeyRepository, clock, idGenerator } =
    deps;
  const router = Router();
  const authenticated = [authenticate(accessTokenService, sessionDenylist)];

  router.post(
    '/',
    ...authenticated,
    requirePermission('PLACE_ORDER'),
    validate({ body: createReservationRequestSchema }),
    idempotency(idempotencyKeyRepository, CREATE_RESERVATION_ENDPOINT, { clock, idGenerator }),
    asyncHandler(controller.create),
  );

  router.get(
    '/',
    ...authenticated,
    requirePermission('VIEW_OWN_ORDERS'),
    validate({ query: cursorPaginationSchema.strict() }),
    asyncHandler(controller.list),
  );

  router.get(
    '/:id',
    ...authenticated,
    requirePermission('VIEW_OWN_ORDERS'),
    validate({ params: reservationParamsSchema }),
    asyncHandler(controller.get),
  );

  router.post(
    '/:id/cancel',
    ...authenticated,
    requirePermission('CANCEL_OWN_ORDER'),
    validate({ params: reservationParamsSchema }),
    asyncHandler(controller.cancel),
  );

  mountPaymentRoutes(router, controller, deps);

  return router;
};
