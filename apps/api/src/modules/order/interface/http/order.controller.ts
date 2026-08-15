import type { Request, Response } from 'express';
import type {
  OrderItemResponse,
  OrderResponse,
  PlaceOrderRequest,
  SubOrderResponse,
} from '@leen-mart/contracts';
import { getRequestId } from '../../../../shared/interface/http/middleware/request-context.js';
import { validatedData } from '../../../../shared/interface/http/middleware/validate.js';
import type { Order } from '../../domain/entities/order.entity.js';
import type { OrderItem } from '../../domain/entities/order-item.entity.js';
import type { SubOrder } from '../../domain/entities/sub-order.entity.js';
import { toAddressId } from '../../../customer/index.js';
import { toOrderId } from '../../domain/value-objects/order-id.value-object.js';
import type { CancelOrderUseCase } from '../../application/use-cases/cancel-order.use-case.js';
import type { GetOrderUseCase } from '../../application/use-cases/get-order.use-case.js';
import type { PlaceOrderUseCase } from '../../application/use-cases/place-order.use-case.js';

export interface OrderController {
  readonly placeOrder: (req: Request, res: Response) => Promise<void>;
  readonly getOrder: (req: Request, res: Response) => Promise<void>;
  readonly cancelOrder: (req: Request, res: Response) => Promise<void>;
}

export interface OrderControllerDeps {
  readonly placeOrderUseCase: PlaceOrderUseCase;
  readonly getOrderUseCase: GetOrderUseCase;
  readonly cancelOrderUseCase: CancelOrderUseCase;
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

/**
 * Thin HTTP adapter. Parses nothing itself (`validate()`'s job), translates
 * no errors (the global error handler's job, SDD 17.1).
 */
export const createOrderController = (deps: OrderControllerDeps): OrderController => ({
  placeOrder: async (req: Request, res: Response): Promise<void> => {
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
    });

    res.status(201).json({ data: toOrderResponse(order), meta: { requestId: getRequestId() } });
  },

  getOrder: async (req: Request, res: Response): Promise<void> => {
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
  },

  cancelOrder: async (req: Request, res: Response): Promise<void> => {
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
  },
});
