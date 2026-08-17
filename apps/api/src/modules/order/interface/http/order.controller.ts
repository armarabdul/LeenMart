import type { Request, Response } from 'express';
import type {
  ConfirmPaymentRequest,
  OrderItemResponse,
  OrderResponse,
  OrderSummaryResponse,
  PaymentInitiationResponse,
  PickupTokenResponse,
  PlaceOrderRequest,
  SubOrderResponse,
} from '@leen-mart/contracts';
import { getRequestId } from '../../../../shared/interface/http/middleware/request-context.js';
import { validatedData } from '../../../../shared/interface/http/middleware/validate.js';
import { toVendorId } from '../../../identity/index.js';
import type { Order } from '../../domain/entities/order.entity.js';
import type { OrderItem } from '../../domain/entities/order-item.entity.js';
import type { PaymentAttempt } from '../../domain/entities/payment-attempt.entity.js';
import type { SubOrder } from '../../domain/entities/sub-order.entity.js';
import type { OrderSummary } from '../../domain/repositories/order.repository.js';
import { toAddressId } from '../../../customer/index.js';
import { toOrderId } from '../../domain/value-objects/order-id.value-object.js';
import { toSubOrderId } from '../../domain/value-objects/sub-order-id.value-object.js';
import type { CancelOrderUseCase } from '../../application/use-cases/cancel-order.use-case.js';
import type { ConfirmPaymentUseCase } from '../../application/use-cases/confirm-payment.use-case.js';
import type { GetOrderUseCase } from '../../application/use-cases/get-order.use-case.js';
import type { GetOrIssuePickupTokenUseCase } from '../../application/use-cases/get-or-issue-pickup-token.use-case.js';
import type { InitiatePaymentUseCase } from '../../application/use-cases/initiate-payment.use-case.js';
import type { ListOrdersUseCase } from '../../application/use-cases/list-orders.use-case.js';
import type { PlaceOrderUseCase } from '../../application/use-cases/place-order.use-case.js';

export interface OrderController {
  readonly placeOrder: (req: Request, res: Response) => Promise<void>;
  readonly getOrder: (req: Request, res: Response) => Promise<void>;
  readonly listOrders: (req: Request, res: Response) => Promise<void>;
  readonly cancelOrder: (req: Request, res: Response) => Promise<void>;
  readonly initiatePayment: (req: Request, res: Response) => Promise<void>;
  readonly confirmPayment: (req: Request, res: Response) => Promise<void>;
  readonly getPickupToken: (req: Request, res: Response) => Promise<void>;
}

export interface OrderControllerDeps {
  readonly placeOrderUseCase: PlaceOrderUseCase;
  readonly getOrderUseCase: GetOrderUseCase;
  readonly listOrdersUseCase: ListOrdersUseCase;
  readonly cancelOrderUseCase: CancelOrderUseCase;
  readonly initiatePaymentUseCase: InitiatePaymentUseCase;
  readonly confirmPaymentUseCase: ConfirmPaymentUseCase;
  readonly getOrIssuePickupTokenUseCase: GetOrIssuePickupTokenUseCase;
}

/**
 * Mapped field by field, never spread, matching this codebase's own
 * "deliberately narrow" DTO discipline (see `vendor.controller.ts`'s
 * `submitKyc` comment). `OrderItem.commissionAmount`/`commissionRateBasisPoints`
 * are deliberately never read here — an internal, vendor-payout figure that
 * never reaches the customer response (see `order.contract.ts`'s own
 * comment on `orderItemResponseSchema`).
 */
const toOrderItemResponse = (item: OrderItem): OrderItemResponse => ({
  id: item.id,
  productId: item.productId,
  variantId: item.variantId,
  productName: item.productNameSnapshot,
  variantName: item.variantNameSnapshot,
  vendorShopName: item.vendorShopNameSnapshot,
  unitOfMeasure: item.unitOfMeasureSnapshot,
  quantity: item.quantity,
  unitPrice: item.unitPrice.toJSON(),
  lineAmount: item.lineAmount.toJSON(),
  hsnCode: item.hsnCodeSnapshot,
  tax: item.tax.resolved
    ? {
        resolved: true,
        rateBasisPoints: item.tax.rateBasisPoints,
        amount: item.tax.amount.toJSON(),
      }
    : { resolved: false },
});

const toSubOrderResponse = (subOrder: SubOrder): SubOrderResponse => ({
  id: subOrder.id,
  vendorShopName: subOrder.vendorShopNameSnapshot,
  status: subOrder.status.name,
  fulfilmentMode: subOrder.fulfilmentMode.name,
  totalAmount: subOrder.totalAmount.toJSON(),
  items: subOrder.items.map(toOrderItemResponse),
});

const toOrderResponse = (order: Order): OrderResponse => ({
  id: order.id,
  status: order.status.name,
  totalAmount: order.totalAmount.toJSON(),
  address: {
    recipientName: order.address.recipientName,
    phone: order.address.phone,
    line1: order.address.line1,
    line2: order.address.line2,
    city: order.address.city,
    state: order.address.state,
    pincode: order.address.pincode,
    landmark: order.address.landmark,
    label: order.address.label,
  },
  subOrders: order.subOrders.map(toSubOrderResponse),
  createdAt: order.createdAt.toISOString(),
  updatedAt: order.updatedAt.toISOString(),
});

/** `PaymentAttempt` never reaches the customer response beyond this — no `providerReference`, no internal attempt id (no approved contract needs either). */
const toPaymentInitiationResponse = (attempt: PaymentAttempt): PaymentInitiationResponse => ({
  orderId: attempt.orderId,
  status: 'PAYMENT_PENDING',
});

/** S3-4 "My Orders" row — mapped from the repository's own narrow `OrderSummary`, never a full `Order`. */
const toOrderSummaryResponse = (summary: OrderSummary): OrderSummaryResponse => ({
  id: summary.id,
  status: summary.status.name,
  totalAmount: summary.totalAmount.toJSON(),
  createdAt: summary.createdAt.toISOString(),
});

/**
 * Every handler below is split out of `createOrderController` purely to keep
 * that composition root under this file's max-lines-per-function budget —
 * same reasoning as the DTO mappers above. Each is a plain
 * `(deps) => (req, res) => Promise<void>` factory, still a thin HTTP adapter:
 * parses nothing itself (`validate()`'s job), translates no errors (the
 * global error handler's job, SDD 17.1).
 */
const placeOrderHandler =
  (deps: OrderControllerDeps) =>
  async (req: Request, res: Response): Promise<void> => {
    if (!req.principal) {
      throw new Error(
        'POST /orders reached without authenticate() middleware — req.principal is unset.',
      );
    }
    const { body } = validatedData<PlaceOrderRequest>(req);

    const order = await deps.placeOrderUseCase.execute({
      principal: req.principal,
      addressId: toAddressId(body.addressId),
      paymentMethod: body.paymentMethod,
      pickupVendorIds: body.pickupVendorIds?.map(toVendorId),
    });

    res.status(201).json({ data: toOrderResponse(order), meta: { requestId: getRequestId() } });
  };

const getOrderHandler =
  (deps: OrderControllerDeps) =>
  async (req: Request, res: Response): Promise<void> => {
    if (!req.principal) {
      throw new Error(
        'GET /orders/:id reached without authenticate() middleware — req.principal is unset.',
      );
    }
    const { params } = validatedData<unknown, unknown, { id: string }>(req);

    const order = await deps.getOrderUseCase.execute({
      principal: req.principal,
      orderId: toOrderId(params.id),
    });

    res.status(200).json({ data: toOrderResponse(order), meta: { requestId: getRequestId() } });
  };

const listOrdersHandler =
  (deps: OrderControllerDeps) =>
  async (req: Request, res: Response): Promise<void> => {
    if (!req.principal) {
      throw new Error(
        'GET /orders reached without authenticate() middleware — req.principal is unset.',
      );
    }

    const orders = await deps.listOrdersUseCase.execute({ principal: req.principal });

    res
      .status(200)
      .json({ data: orders.map(toOrderSummaryResponse), meta: { requestId: getRequestId() } });
  };

const cancelOrderHandler =
  (deps: OrderControllerDeps) =>
  async (req: Request, res: Response): Promise<void> => {
    if (!req.principal) {
      throw new Error(
        'POST /orders/:id/cancel reached without authenticate() middleware — req.principal is unset.',
      );
    }
    const { params } = validatedData<unknown, unknown, { id: string }>(req);

    const order = await deps.cancelOrderUseCase.execute({
      principal: req.principal,
      orderId: toOrderId(params.id),
    });

    res.status(200).json({ data: toOrderResponse(order), meta: { requestId: getRequestId() } });
  };

const initiatePaymentHandler =
  (deps: OrderControllerDeps) =>
  async (req: Request, res: Response): Promise<void> => {
    if (!req.principal) {
      throw new Error(
        'POST /orders/:id/payment/initiate reached without authenticate() middleware — req.principal is unset.',
      );
    }
    const { params } = validatedData<unknown, unknown, { id: string }>(req);

    const attempt = await deps.initiatePaymentUseCase.execute({
      principal: req.principal,
      orderId: toOrderId(params.id),
    });

    res
      .status(201)
      .json({ data: toPaymentInitiationResponse(attempt), meta: { requestId: getRequestId() } });
  };

const confirmPaymentHandler =
  (deps: OrderControllerDeps) =>
  async (req: Request, res: Response): Promise<void> => {
    if (!req.principal) {
      throw new Error(
        'POST /orders/:id/payment/confirm reached without authenticate() middleware — req.principal is unset.',
      );
    }
    const { params, body } = validatedData<ConfirmPaymentRequest, unknown, { id: string }>(req);

    const order = await deps.confirmPaymentUseCase.execute({
      principal: req.principal,
      orderId: toOrderId(params.id),
      testScenario: body.testScenario,
    });

    res.status(200).json({ data: toOrderResponse(order), meta: { requestId: getRequestId() } });
  };

const getPickupTokenHandler =
  (deps: OrderControllerDeps) =>
  async (req: Request, res: Response): Promise<void> => {
    if (!req.principal) {
      throw new Error(
        'GET /orders/:id/sub-orders/:subOrderId/pickup-token reached without authenticate() middleware — req.principal is unset.',
      );
    }
    const { params } = validatedData<unknown, unknown, { id: string; subOrderId: string }>(req);

    const issued = await deps.getOrIssuePickupTokenUseCase.execute({
      principal: req.principal,
      orderId: toOrderId(params.id),
      subOrderId: toSubOrderId(params.subOrderId),
    });

    const data: PickupTokenResponse = {
      token: issued.token,
      expiresAt: issued.expiresAt.toISOString(),
    };
    res.status(200).json({ data, meta: { requestId: getRequestId() } });
  };

export const createOrderController = (deps: OrderControllerDeps): OrderController => ({
  placeOrder: placeOrderHandler(deps),
  getOrder: getOrderHandler(deps),
  listOrders: listOrdersHandler(deps),
  cancelOrder: cancelOrderHandler(deps),
  initiatePayment: initiatePaymentHandler(deps),
  confirmPayment: confirmPaymentHandler(deps),
  getPickupToken: getPickupTokenHandler(deps),
});
