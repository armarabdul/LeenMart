import type { PrismaClient, Prisma } from '@prisma/client';
import { Money, type TransactionScope } from '@leen-mart/domain-kit';
import { toProductId, toProductVariantId } from '../../../catalogue/index.js';
import { toUserId, toVendorId, type UserId } from '../../../identity/index.js';
import { Order, type OrderAddressSnapshot } from '../../domain/entities/order.entity.js';
import { OrderItem, type TaxSnapshot } from '../../domain/entities/order-item.entity.js';
import { SubOrder, type PickupLocationSnapshot } from '../../domain/entities/sub-order.entity.js';
import type { OrderRepository, OrderSummary } from '../../domain/repositories/order.repository.js';
import { SubOrderConcurrentlyModifiedError } from '../../domain/errors/order-errors.js';
import { toOrderId, type OrderId } from '../../domain/value-objects/order-id.value-object.js';
import { toOrderItemId } from '../../domain/value-objects/order-item-id.value-object.js';
import { toSubOrderId } from '../../domain/value-objects/sub-order-id.value-object.js';
import { OrderStatus } from '../../domain/value-objects/order-status.value-object.js';
import { FulfilmentMode } from '../../domain/value-objects/fulfilment-mode.value-object.js';

type OrderRow = Prisma.OrderGetPayload<{
  include: { subOrders: { include: { items: true } } };
}>;

/**
 * S4-ADDR. Collapses the five nullable snapshot columns back into one
 * all-or-nothing object, keyed off the mandatory parts — they are only ever
 * written as a set, so any one being null means "no pickup location".
 */

/** Explodes the snapshot back into its flat columns, or writes all five as null. */
const pickupLocationColumns = (
  snapshot: PickupLocationSnapshot | null,
): {
  pickupLocationLine1: string | null;
  pickupLocationLine2: string | null;
  pickupLocationCity: string | null;
  pickupLocationState: string | null;
  pickupLocationPincode: string | null;
} => ({
  pickupLocationLine1: snapshot === null ? null : snapshot.line1,
  pickupLocationLine2: snapshot === null ? null : snapshot.line2,
  pickupLocationCity: snapshot === null ? null : snapshot.city,
  pickupLocationState: snapshot === null ? null : snapshot.state,
  pickupLocationPincode: snapshot === null ? null : snapshot.pincode,
});

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

const toOrderItem = (row: OrderRow['subOrders'][number]['items'][number]): OrderItem =>
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

const toSubOrder = (row: OrderRow['subOrders'][number]): SubOrder =>
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

const toDomain = (row: OrderRow): Order => {
  const address: OrderAddressSnapshot = {
    recipientName: row.addressRecipientName,
    phone: row.addressPhone,
    line1: row.addressLine1,
    line2: row.addressLine2,
    city: row.addressCity,
    state: row.addressState,
    pincode: row.addressPincode,
    landmark: row.addressLandmark,
    label: row.addressLabel,
  };
  return Order.reconstitute({
    id: toOrderId(row.id),
    customerId: toUserId(row.customerId),
    status: OrderStatus.fromName(row.status),
    totalAmount: Money.fromMinor(row.totalAmount, row.totalCurrency as 'INR'),
    address,
    subOrders: row.subOrders.map(toSubOrder),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
};

const toSummary = (row: {
  id: string;
  status: string;
  totalAmount: bigint;
  totalCurrency: string;
  createdAt: Date;
}): OrderSummary => ({
  id: toOrderId(row.id),
  status: OrderStatus.fromName(row.status),
  totalAmount: Money.fromMinor(row.totalAmount, row.totalCurrency as 'INR'),
  createdAt: row.createdAt,
});

/**
 * `orders`/`sub_orders`/`order_items` (S3-3A). Bound to `leenmart_checkout` —
 * customer-owned, no RLS, ownership enforced here by `(id, customerId)`
 * scoping, the same convention `PrismaAddressRepository` already
 * establishes for a table with no tenant concept at all.
 */
interface OrderAddressSnapshotColumns {
  readonly addressRecipientName: string;
  readonly addressPhone: string;
  readonly addressLine1: string;
  readonly addressLine2: string | null;
  readonly addressCity: string;
  readonly addressState: string;
  readonly addressPincode: string;
  readonly addressLabel: string;
}

/** The order's immutable delivery-address snapshot, split out to keep `create` within this file's function-length budget. */
const addressSnapshotOf = (order: Order): OrderAddressSnapshotColumns => ({
  addressRecipientName: order.address.recipientName,
  addressPhone: order.address.phone,
  addressLine1: order.address.line1,
  addressLine2: order.address.line2,
  addressCity: order.address.city,
  addressState: order.address.state,
  addressPincode: order.address.pincode,
  addressLabel: order.address.label,
});

export class PrismaOrderRepository implements OrderRepository {
  constructor(private readonly prisma: PrismaClient) {}

  withTransaction(scope: TransactionScope): OrderRepository {
    return new PrismaOrderRepository(scope as unknown as PrismaClient);
  }

  /** One nested Prisma write — order, every sub-order and every order item — genuinely atomic on whatever connection `this.prisma` is bound to. */
  async create(order: Order): Promise<void> {
    await this.prisma.order.create({
      data: {
        id: order.id,
        customerId: order.customerId,
        status: order.status.name,
        totalAmount: order.totalAmount.amountMinor,
        totalCurrency: order.totalAmount.currency,
        ...addressSnapshotOf(order),
        addressLandmark: order.address.landmark,
        createdAt: order.createdAt,
        updatedAt: order.updatedAt,
        subOrders: {
          create: order.subOrders.map((subOrder) => ({
            id: subOrder.id,
            vendorId: subOrder.vendorId,
            status: subOrder.status.name,
            fulfilmentMode: subOrder.fulfilmentMode.name,
            vendorShopNameSnapshot: subOrder.vendorShopNameSnapshot,
            ...pickupLocationColumns(subOrder.pickupLocationSnapshot),
            totalAmount: subOrder.totalAmount.amountMinor,
            totalCurrency: subOrder.totalAmount.currency,
            createdAt: subOrder.createdAt,
            updatedAt: subOrder.updatedAt,
            items: {
              create: subOrder.items.map((item) => ({
                id: item.id,
                productId: item.productId,
                variantId: item.variantId,
                vendorId: item.vendorId,
                productNameSnapshot: item.productNameSnapshot,
                variantNameSnapshot: item.variantNameSnapshot,
                vendorShopNameSnapshot: item.vendorShopNameSnapshot,
                unitOfMeasureSnapshot: item.unitOfMeasureSnapshot,
                quantity: item.quantity,
                unitPriceAmount: item.unitPrice.amountMinor,
                unitPriceCurrency: item.unitPrice.currency,
                lineAmount: item.lineAmount.amountMinor,
                lineCurrency: item.lineAmount.currency,
                hsnCodeSnapshot: item.hsnCodeSnapshot,
                taxResolved: item.tax.resolved,
                taxRateBasisPoints: item.tax.resolved ? item.tax.rateBasisPoints : null,
                taxAmount: item.tax.resolved ? item.tax.amount.amountMinor : null,
                taxCurrency: item.tax.resolved ? item.tax.amount.currency : null,
                commissionRateBasisPoints: item.commissionRateBasisPoints,
                commissionAmount: item.commissionAmount.amountMinor,
                commissionCurrency: item.commissionAmount.currency,
                createdAt: item.createdAt,
              })),
            },
          })),
        },
      },
    });
  }

  async findByIdAndCustomerId(id: OrderId, customerId: Order['customerId']): Promise<Order | null> {
    const row = await this.prisma.order.findFirst({
      where: { id, customerId },
      include: { subOrders: { include: { items: true } } },
    });
    return row ? toDomain(row) : null;
  }

  /** No `include` at all — the summary row needs none of `subOrders`/items, so the query never fetches them (S3-4). */
  async findAllByCustomerId(customerId: UserId, limit: number): Promise<readonly OrderSummary[]> {
    const rows = await this.prisma.order.findMany({
      where: { customerId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit,
      select: { id: true, status: true, totalAmount: true, totalCurrency: true, createdAt: true },
    });
    return rows.map(toSummary);
  }

  /**
   * Writes the order's own status, then every sub-order's — sequential
   * `update` calls on `this.prisma`, never a nested `$transaction`: this
   * method is always reached already inside `CheckoutTransactionRunner`'s
   * open transaction, and opening a second one on the same connection is
   * exactly the pitfall `runInTenantTransaction`'s own comment documents
   * for the tenant-scoped client.
   *
   * Each sub-order write is version-guarded (S3-5): from this milestone
   * onward a vendor's own `StartProcessingUseCase` can write the very same
   * row on a different credential (`leenmart_app`) between this method's
   * read and write. `updateMany` with `version` in the `WHERE` — never a
   * prior read, the same `Inventory.setIfVersionMatches` idiom — means a
   * lost race throws `SubOrderConcurrentlyModifiedError` instead of silently
   * overwriting whatever the vendor just wrote (or the vendor's write
   * silently overwriting a customer's cancellation, the same failure mode in
   * reverse).
   */
  async updateStatus(order: Order): Promise<void> {
    await this.prisma.order.update({
      where: { id: order.id },
      data: { status: order.status.name, updatedAt: order.updatedAt },
    });
    for (const subOrder of order.subOrders) {
      const result = await this.prisma.subOrder.updateMany({
        where: { id: subOrder.id, version: subOrder.version },
        data: {
          status: subOrder.status.name,
          updatedAt: subOrder.updatedAt,
          version: { increment: 1 },
        },
      });
      if (result.count !== 1) {
        throw new SubOrderConcurrentlyModifiedError();
      }
    }
  }
}
