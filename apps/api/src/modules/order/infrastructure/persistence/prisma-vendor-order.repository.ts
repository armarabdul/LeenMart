import type { PrismaClient, Prisma } from '@prisma/client';
import { Money, type TransactionScope } from '@leen-mart/domain-kit';
import { toProductId, toProductVariantId } from '../../../catalogue/index.js';
import { toVendorId } from '../../../identity/index.js';
import type { OrderAddressSnapshot } from '../../domain/entities/order.entity.js';
import { OrderItem, type TaxSnapshot } from '../../domain/entities/order-item.entity.js';
import { SubOrder, type PickupLocationSnapshot } from '../../domain/entities/sub-order.entity.js';
import type {
  VendorOrderRepository,
  VendorSubOrderDetail,
  VendorSubOrderSummary,
} from '../../domain/repositories/vendor-order.repository.js';
import { toOrderId } from '../../domain/value-objects/order-id.value-object.js';
import { toOrderItemId } from '../../domain/value-objects/order-item-id.value-object.js';
import { OrderStatus } from '../../domain/value-objects/order-status.value-object.js';
import { FulfilmentMode } from '../../domain/value-objects/fulfilment-mode.value-object.js';
import {
  toSubOrderId,
  type SubOrderId,
} from '../../domain/value-objects/sub-order-id.value-object.js';

type SubOrderDetailRow = Prisma.SubOrderGetPayload<{
  include: { items: true; order: { select: typeof ADDRESS_SELECT } };
}>;

/**
 * S4-ADDR. Collapses the five nullable snapshot columns back into one
 * all-or-nothing object, keyed off the mandatory parts — they are only ever
 * written as a set, so any one being null means "no pickup location".
 */
const toPickupLocationSnapshot = (row: {
  pickupLocationLine1: string | null;
  pickupLocationLine2: string | null;
  pickupLocationCity: string | null;
  pickupLocationState: string | null;
  pickupLocationPincode: string | null;
}): PickupLocationSnapshot | null => {
  const { pickupLocationLine1, pickupLocationCity, pickupLocationState, pickupLocationPincode } =
    row;
  if (
    !pickupLocationLine1 ||
    !pickupLocationCity ||
    !pickupLocationState ||
    !pickupLocationPincode
  ) {
    return null;
  }
  return {
    line1: pickupLocationLine1,
    line2: row.pickupLocationLine2,
    city: pickupLocationCity,
    state: pickupLocationState,
    pincode: pickupLocationPincode,
  };
};

const ADDRESS_SELECT = {
  addressRecipientName: true,
  addressPhone: true,
  addressLine1: true,
  addressLine2: true,
  addressCity: true,
  addressState: true,
  addressPincode: true,
  addressLandmark: true,
  addressLabel: true,
} as const;

const toTaxSnapshot = (row: {
  taxResolved: boolean;
  taxRateBasisPoints: number | null;
  taxAmount: bigint | null;
  taxCurrency: string | null;
}): TaxSnapshot =>
  row.taxResolved && row.taxRateBasisPoints !== null && row.taxAmount !== null
    ? {
        resolved: true,
        rateBasisPoints: row.taxRateBasisPoints,
        amount: Money.fromMinor(row.taxAmount, (row.taxCurrency ?? 'INR') as 'INR'),
      }
    : { resolved: false, rateBasisPoints: null, amount: null };

const toOrderItem = (row: SubOrderDetailRow['items'][number]): OrderItem =>
  OrderItem.reconstitute({
    id: toOrderItemId(row.id),
    subOrderId: toSubOrderId(row.subOrderId),
    productId: toProductId(row.productId),
    variantId: toProductVariantId(row.variantId),
    vendorId: toVendorId(row.vendorId),
    productNameSnapshot: row.productNameSnapshot,
    variantNameSnapshot: row.variantNameSnapshot,
    vendorShopNameSnapshot: row.vendorShopNameSnapshot,
    unitOfMeasureSnapshot: row.unitOfMeasureSnapshot,
    quantity: row.quantity,
    unitPrice: Money.fromMinor(row.unitPriceAmount, row.unitPriceCurrency as 'INR'),
    lineAmount: Money.fromMinor(row.lineAmount, row.lineCurrency as 'INR'),
    hsnCodeSnapshot: row.hsnCodeSnapshot,
    tax: toTaxSnapshot(row),
    commissionRateBasisPoints: row.commissionRateBasisPoints,
    commissionAmount: Money.fromMinor(row.commissionAmount, row.commissionCurrency as 'INR'),
    createdAt: row.createdAt,
  });

const toAddressSnapshot = (row: {
  addressRecipientName: string;
  addressPhone: string;
  addressLine1: string;
  addressLine2: string | null;
  addressCity: string;
  addressState: string;
  addressPincode: string;
  addressLandmark: string | null;
  addressLabel: string;
}): OrderAddressSnapshot => ({
  recipientName: row.addressRecipientName,
  phone: row.addressPhone,
  line1: row.addressLine1,
  line2: row.addressLine2,
  city: row.addressCity,
  state: row.addressState,
  pincode: row.addressPincode,
  landmark: row.addressLandmark,
  label: row.addressLabel,
});

const toSubOrder = (row: SubOrderDetailRow): SubOrder =>
  SubOrder.reconstitute({
    id: toSubOrderId(row.id),
    orderId: toOrderId(row.orderId),
    vendorId: toVendorId(row.vendorId),
    status: OrderStatus.fromName(row.status),
    fulfilmentMode: FulfilmentMode.fromName(row.fulfilmentMode),
    vendorShopNameSnapshot: row.vendorShopNameSnapshot,
    pickupLocationSnapshot: toPickupLocationSnapshot(row),
    totalAmount: Money.fromMinor(row.totalAmount, row.totalCurrency as 'INR'),
    items: row.items.map(toOrderItem),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    version: row.version,
  });

const toSummary = (row: {
  id: string;
  orderId: string;
  status: string;
  fulfilmentMode: string;
  totalAmount: bigint;
  totalCurrency: string;
  createdAt: Date;
}): VendorSubOrderSummary => ({
  id: toSubOrderId(row.id),
  orderId: toOrderId(row.orderId),
  status: OrderStatus.fromName(row.status),
  fulfilmentMode: FulfilmentMode.fromName(row.fulfilmentMode),
  totalAmount: Money.fromMinor(row.totalAmount, row.totalCurrency as 'INR'),
  createdAt: row.createdAt,
});

/**
 * `sub_orders`/`order_items`/`orders` (S3-5), bound to the tenant-scoped
 * `prisma` client (`leenmart_app`) — no `vendorId` parameter on any method,
 * relying entirely on `tenantContext`'s session GUC plus
 * `sub_orders_vendor_select`/`order_items_vendor_select`/
 * `orders_vendor_select` (20260816130000), the same convention
 * `PrismaProductRepository.findById` already establishes for every other
 * vendor-owned model in this codebase.
 */
export class PrismaVendorOrderRepository implements VendorOrderRepository {
  constructor(private readonly prisma: PrismaClient) {}

  withTransaction(scope: TransactionScope): VendorOrderRepository {
    return new PrismaVendorOrderRepository(scope as unknown as PrismaClient);
  }

  /** No `include` at all — mirrors `OrderRepository.findAllByCustomerId`'s own "the summary row needs none of it" reasoning (S3-4). */
  async findAllByVendor(limit: number): Promise<readonly VendorSubOrderSummary[]> {
    const rows = await this.prisma.subOrder.findMany({
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit,
      select: {
        id: true,
        orderId: true,
        status: true,
        fulfilmentMode: true,
        totalAmount: true,
        totalCurrency: true,
        createdAt: true,
      },
    });
    return rows.map(toSummary);
  }

  async findDetailById(subOrderId: SubOrderId): Promise<VendorSubOrderDetail | null> {
    const row = await this.prisma.subOrder.findFirst({
      where: { id: subOrderId },
      include: { items: true, order: { select: ADDRESS_SELECT } },
    });
    return row ? { subOrder: toSubOrder(row), address: toAddressSnapshot(row.order) } : null;
  }

  /** The version lives in the `WHERE`, never in a prior read — the same `Inventory.setIfVersionMatches` idiom. */
  async updateStatusIfVersionMatches(
    subOrder: SubOrder,
    expectedVersion: number,
  ): Promise<boolean> {
    const result = await this.prisma.subOrder.updateMany({
      where: { id: subOrder.id, version: expectedVersion },
      data: {
        status: subOrder.status.name,
        updatedAt: subOrder.updatedAt,
        version: { increment: 1 },
      },
    });
    return result.count === 1;
  }
}
