import type { Request, Response } from 'express';
import type {
  OrderItemResponse,
  VendorSubOrderResponse,
  VendorSubOrderSummaryResponse,
} from '@leen-mart/contracts';
import { getRequestId } from '../../../../shared/interface/http/middleware/request-context.js';
import { validatedData } from '../../../../shared/interface/http/middleware/validate.js';
import type { OrderItem } from '../../domain/entities/order-item.entity.js';
import type {
  VendorSubOrderDetail,
  VendorSubOrderSummary,
} from '../../domain/repositories/vendor-order.repository.js';
import { toSubOrderId } from '../../domain/value-objects/sub-order-id.value-object.js';
import type { DeliverSubOrderUseCase } from '../../application/use-cases/deliver-sub-order.use-case.js';
import type { GetVendorOrderUseCase } from '../../application/use-cases/get-vendor-order.use-case.js';
import type { ListVendorOrdersUseCase } from '../../application/use-cases/list-vendor-orders.use-case.js';
import type { ShipSubOrderUseCase } from '../../application/use-cases/ship-sub-order.use-case.js';
import type { StartProcessingUseCase } from '../../application/use-cases/start-processing.use-case.js';

export interface VendorOrderController {
  readonly listVendorOrders: (req: Request, res: Response) => Promise<void>;
  readonly getVendorOrder: (req: Request, res: Response) => Promise<void>;
  readonly startProcessing: (req: Request, res: Response) => Promise<void>;
  readonly shipSubOrder: (req: Request, res: Response) => Promise<void>;
  readonly deliverSubOrder: (req: Request, res: Response) => Promise<void>;
}

export interface VendorOrderControllerDeps {
  readonly listVendorOrdersUseCase: ListVendorOrdersUseCase;
  readonly getVendorOrderUseCase: GetVendorOrderUseCase;
  readonly startProcessingUseCase: StartProcessingUseCase;
  readonly shipSubOrderUseCase: ShipSubOrderUseCase;
  readonly deliverSubOrderUseCase: DeliverSubOrderUseCase;
}

const toVendorSubOrderSummaryResponse = (
  summary: VendorSubOrderSummary,
): VendorSubOrderSummaryResponse => ({
  id: summary.id,
  orderId: summary.orderId,
  status: summary.status.name,
  totalAmount: summary.totalAmount.toJSON(),
  createdAt: summary.createdAt.toISOString(),
});

/** Mirrors `order.controller.ts`'s own `toOrderItemResponse` — deliberately never reads `commissionAmount`/`commissionRateBasisPoints`. */
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

const toVendorSubOrderResponse = (detail: VendorSubOrderDetail): VendorSubOrderResponse => ({
  id: detail.subOrder.id,
  orderId: detail.subOrder.orderId,
  status: detail.subOrder.status.name,
  totalAmount: detail.subOrder.totalAmount.toJSON(),
  address: {
    recipientName: detail.address.recipientName,
    phone: detail.address.phone,
    line1: detail.address.line1,
    line2: detail.address.line2,
    city: detail.address.city,
    state: detail.address.state,
    pincode: detail.address.pincode,
    landmark: detail.address.landmark,
    label: detail.address.label,
  },
  items: detail.subOrder.items.map(toOrderItemResponse),
  createdAt: detail.subOrder.createdAt.toISOString(),
  updatedAt: detail.subOrder.updatedAt.toISOString(),
});

/**
 * Every handler is a thin `(deps) => (req, res) => Promise<void>` factory,
 * mirroring `order.controller.ts`'s own composition — split out purely to
 * keep `createVendorOrderController` under this file's max-lines-per-function
 * budget.
 */
const listVendorOrdersHandler =
  (deps: VendorOrderControllerDeps) =>
  async (req: Request, res: Response): Promise<void> => {
    if (!req.principal) {
      throw new Error(
        'GET /vendor/orders reached without authenticate() middleware — req.principal is unset.',
      );
    }

    const subOrders = await deps.listVendorOrdersUseCase.execute({ principal: req.principal });

    res.status(200).json({
      data: subOrders.map(toVendorSubOrderSummaryResponse),
      meta: { requestId: getRequestId() },
    });
  };

const getVendorOrderHandler =
  (deps: VendorOrderControllerDeps) =>
  async (req: Request, res: Response): Promise<void> => {
    if (!req.principal) {
      throw new Error(
        'GET /vendor/orders/:id reached without authenticate() middleware — req.principal is unset.',
      );
    }
    const { params } = validatedData<unknown, unknown, { id: string }>(req);

    const detail = await deps.getVendorOrderUseCase.execute({
      principal: req.principal,
      subOrderId: toSubOrderId(params.id),
    });

    res.status(200).json({
      data: toVendorSubOrderResponse(detail),
      meta: { requestId: getRequestId() },
    });
  };

const startProcessingHandler =
  (deps: VendorOrderControllerDeps) =>
  async (req: Request, res: Response): Promise<void> => {
    if (!req.principal) {
      throw new Error(
        'POST /vendor/orders/:id/process reached without authenticate() middleware — req.principal is unset.',
      );
    }
    const { params } = validatedData<unknown, unknown, { id: string }>(req);

    const detail = await deps.startProcessingUseCase.execute({
      principal: req.principal,
      subOrderId: toSubOrderId(params.id),
    });

    res.status(200).json({
      data: toVendorSubOrderResponse(detail),
      meta: { requestId: getRequestId() },
    });
  };

const shipSubOrderHandler =
  (deps: VendorOrderControllerDeps) =>
  async (req: Request, res: Response): Promise<void> => {
    if (!req.principal) {
      throw new Error(
        'POST /vendor/orders/:id/ship reached without authenticate() middleware — req.principal is unset.',
      );
    }
    const { params } = validatedData<unknown, unknown, { id: string }>(req);

    const detail = await deps.shipSubOrderUseCase.execute({
      principal: req.principal,
      subOrderId: toSubOrderId(params.id),
    });

    res.status(200).json({
      data: toVendorSubOrderResponse(detail),
      meta: { requestId: getRequestId() },
    });
  };

const deliverSubOrderHandler =
  (deps: VendorOrderControllerDeps) =>
  async (req: Request, res: Response): Promise<void> => {
    if (!req.principal) {
      throw new Error(
        'POST /vendor/orders/:id/deliver reached without authenticate() middleware — req.principal is unset.',
      );
    }
    const { params } = validatedData<unknown, unknown, { id: string }>(req);

    const detail = await deps.deliverSubOrderUseCase.execute({
      principal: req.principal,
      subOrderId: toSubOrderId(params.id),
    });

    res.status(200).json({
      data: toVendorSubOrderResponse(detail),
      meta: { requestId: getRequestId() },
    });
  };

export const createVendorOrderController = (
  deps: VendorOrderControllerDeps,
): VendorOrderController => ({
  listVendorOrders: listVendorOrdersHandler(deps),
  getVendorOrder: getVendorOrderHandler(deps),
  startProcessing: startProcessingHandler(deps),
  shipSubOrder: shipSubOrderHandler(deps),
  deliverSubOrder: deliverSubOrderHandler(deps),
});
