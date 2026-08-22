import type { Request, Response } from 'express';
import type {
  ConfirmReservationPaymentRequest,
  CreateReservationRequest,
  ReservationPaymentInitiationResponse,
  ReservationResponse,
} from '@leen-mart/contracts';
import { getRequestId } from '../../../../shared/interface/http/middleware/request-context.js';
import { validatedData } from '../../../../shared/interface/http/middleware/validate.js';
import { toAddressId } from '../../../customer/index.js';
import type { PreorderPaymentAttempt } from '../../domain/entities/preorder-payment-attempt.entity.js';
import type { PreorderReservation } from '../../domain/entities/preorder-reservation.entity.js';
import { toCampaignId } from '../../domain/value-objects/campaign-id.value-object.js';
import { toReservationId } from '../../domain/value-objects/reservation-id.value-object.js';
import type { CreateReservationUseCase } from '../../application/use-cases/create-reservation.use-case.js';
import type { CancelReservationUseCase } from '../../application/use-cases/cancel-reservation.use-case.js';
import type { GetReservationUseCase } from '../../application/use-cases/get-reservation.use-case.js';
import type { ListMyReservationsUseCase } from '../../application/use-cases/list-my-reservations.use-case.js';
import type { InitiateReservationPaymentUseCase } from '../../application/use-cases/initiate-reservation-payment.use-case.js';
import type { ConfirmReservationPaymentUseCase } from '../../application/use-cases/confirm-reservation-payment.use-case.js';

export interface ReservationController {
  readonly create: (req: Request, res: Response) => Promise<void>;
  readonly get: (req: Request, res: Response) => Promise<void>;
  readonly list: (req: Request, res: Response) => Promise<void>;
  readonly cancel: (req: Request, res: Response) => Promise<void>;
  readonly initiateAdvancePayment: (req: Request, res: Response) => Promise<void>;
  readonly confirmAdvancePayment: (req: Request, res: Response) => Promise<void>;
  readonly initiateBalancePayment: (req: Request, res: Response) => Promise<void>;
  readonly confirmBalancePayment: (req: Request, res: Response) => Promise<void>;
}

export interface ReservationControllerDeps {
  readonly createReservationUseCase: CreateReservationUseCase;
  readonly getReservationUseCase: GetReservationUseCase;
  readonly listMyReservationsUseCase: ListMyReservationsUseCase;
  readonly cancelReservationUseCase: CancelReservationUseCase;
  readonly initiateReservationPaymentUseCase: InitiateReservationPaymentUseCase;
  readonly confirmReservationPaymentUseCase: ConfirmReservationPaymentUseCase;
}

/** Mapped field by field, never spread. Never publishes `customerId`/`vendorId` — the caller already knows both. */
const toReservationResponse = (reservation: PreorderReservation): ReservationResponse => ({
  id: reservation.id,
  campaignId: reservation.campaignId,
  quantity: reservation.quantity,
  fulfilmentMode: reservation.fulfilmentMode,
  addressId: reservation.addressId,
  status: reservation.status.name,
  unitPrice: reservation.unitPrice.toJSON(),
  advanceAmount: reservation.advanceAmount.toJSON(),
  balanceAmount: reservation.balanceAmount.toJSON(),
  expiresAt: reservation.expiresAt.toISOString(),
  confirmedAt: reservation.confirmedAt?.toISOString() ?? null,
  balancePaidAt: reservation.balancePaidAt?.toISOString() ?? null,
  convertedOrderId: reservation.convertedOrderId,
  createdAt: reservation.createdAt.toISOString(),
  updatedAt: reservation.updatedAt.toISOString(),
});

/** Mirrors `toPaymentInitiationResponse` (order.controller.ts) — no `providerReference`, no internal attempt id reaches the wire. */
const toPaymentInitiationResponse = (
  attempt: PreorderPaymentAttempt,
): ReservationPaymentInitiationResponse => ({
  reservationId: attempt.reservationId,
  status: 'PAYMENT_PENDING',
});

const principalOf = (req: Request, route: string): NonNullable<Request['principal']> => {
  if (!req.principal) {
    throw new Error(`${route} reached without authenticate() middleware — req.principal is unset.`);
  }
  return req.principal;
};

const createHandler =
  (deps: ReservationControllerDeps): ReservationController['create'] =>
  async (req: Request, res: Response): Promise<void> => {
    const principal = principalOf(req, 'POST /preorder-reservations');
    const { body } = validatedData<CreateReservationRequest>(req);

    const reservation = await deps.createReservationUseCase.execute({
      customerId: principal.userId,
      campaignId: toCampaignId(body.campaignId),
      quantity: body.quantity,
      fulfilmentMode: body.fulfilmentMode,
      addressId: toAddressId(body.addressId),
    });

    res
      .status(201)
      .json({ data: toReservationResponse(reservation), meta: { requestId: getRequestId() } });
  };

const getHandler =
  (deps: ReservationControllerDeps): ReservationController['get'] =>
  async (req: Request, res: Response): Promise<void> => {
    const principal = principalOf(req, 'GET /preorder-reservations/:id');
    const { params } = validatedData<unknown, unknown, { id: string }>(req);

    const reservation = await deps.getReservationUseCase.execute({
      customerId: principal.userId,
      reservationId: toReservationId(params.id),
    });

    res
      .status(200)
      .json({ data: toReservationResponse(reservation), meta: { requestId: getRequestId() } });
  };

const listHandler =
  (deps: ReservationControllerDeps): ReservationController['list'] =>
  async (req: Request, res: Response): Promise<void> => {
    const principal = principalOf(req, 'GET /preorder-reservations');
    const { query } = validatedData<unknown, { limit?: number; cursor?: string }>(req);

    const page = await deps.listMyReservationsUseCase.execute({
      customerId: principal.userId,
      limit: query?.limit ?? 20,
      cursor: query?.cursor,
    });

    res.status(200).json({
      data: page.items.map(toReservationResponse),
      meta: {
        requestId: getRequestId(),
        pagination: { nextCursor: page.nextCursor, hasMore: page.hasMore },
      },
    });
  };

const cancelHandler =
  (deps: ReservationControllerDeps): ReservationController['cancel'] =>
  async (req: Request, res: Response): Promise<void> => {
    const principal = principalOf(req, 'POST /preorder-reservations/:id/cancel');
    const { params } = validatedData<unknown, unknown, { id: string }>(req);

    const reservation = await deps.cancelReservationUseCase.execute({
      customerId: principal.userId,
      reservationId: toReservationId(params.id),
    });

    res
      .status(200)
      .json({ data: toReservationResponse(reservation), meta: { requestId: getRequestId() } });
  };

const initiatePaymentHandler =
  (
    deps: ReservationControllerDeps,
    kind: 'ADVANCE' | 'BALANCE',
    route: string,
  ): ReservationController['initiateAdvancePayment'] =>
  async (req: Request, res: Response): Promise<void> => {
    const principal = principalOf(req, route);
    const { params } = validatedData<unknown, unknown, { id: string }>(req);

    const attempt = await deps.initiateReservationPaymentUseCase.execute({
      customerId: principal.userId,
      reservationId: toReservationId(params.id),
      kind,
    });

    res
      .status(201)
      .json({ data: toPaymentInitiationResponse(attempt), meta: { requestId: getRequestId() } });
  };

const confirmPaymentHandler =
  (
    deps: ReservationControllerDeps,
    kind: 'ADVANCE' | 'BALANCE',
    route: string,
  ): ReservationController['confirmAdvancePayment'] =>
  async (req: Request, res: Response): Promise<void> => {
    const principal = principalOf(req, route);
    const { params, body } = validatedData<
      ConfirmReservationPaymentRequest,
      unknown,
      { id: string }
    >(req);

    const reservation = await deps.confirmReservationPaymentUseCase.execute({
      customerId: principal.userId,
      reservationId: toReservationId(params.id),
      kind,
      testScenario: body.testScenario,
    });

    res
      .status(200)
      .json({ data: toReservationResponse(reservation), meta: { requestId: getRequestId() } });
  };

export const createReservationController = (
  deps: ReservationControllerDeps,
): ReservationController => ({
  create: createHandler(deps),
  get: getHandler(deps),
  list: listHandler(deps),
  cancel: cancelHandler(deps),
  initiateAdvancePayment: initiatePaymentHandler(
    deps,
    'ADVANCE',
    'POST /preorder-reservations/:id/advance-payment/initiate',
  ),
  confirmAdvancePayment: confirmPaymentHandler(
    deps,
    'ADVANCE',
    'POST /preorder-reservations/:id/advance-payment/confirm',
  ),
  initiateBalancePayment: initiatePaymentHandler(
    deps,
    'BALANCE',
    'POST /preorder-reservations/:id/balance-payment/initiate',
  ),
  confirmBalancePayment: confirmPaymentHandler(
    deps,
    'BALANCE',
    'POST /preorder-reservations/:id/balance-payment/confirm',
  ),
});
