import type { PrismaClient, Prisma } from '@prisma/client';
import { Money, type TransactionScope } from '@leen-mart/domain-kit';
import { toProductId, toProductVariantId } from '../../../catalogue/index.js';
import { toUserId, toVendorId } from '../../../identity/index.js';
import { Order, type OrderAddressSnapshot } from '../../domain/entities/order.entity.js';
import { OrderItem, type TaxSnapshot } from '../../domain/entities/order-item.entity.js';
import { SubOrder } from '../../domain/entities/sub-order.entity.js';
import type { OrderRepository } from '../../domain/repositories/order.repository.js';
import { toOrderId, type OrderId } from '../../domain/value-objects/order-id.value-object.js';
import { toOrderItemId } from '../../domain/value-objects/order-item-id.value-object.js';
import { toSubOrderId } from '../../domain/value-objects/sub-order-id.value-object.js';
import { OrderStatus } from '../../domain/value-objects/order-status.value-object.js';

type OrderRow = Prisma.OrderGetPayload<{
  include: { subOrders: { include: { items: true } } };
}>;

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
    vendorShopNameSnapshot: row.vendorShopNameSnapshot,
    totalAmount: Money.fromMinor(row.totalAmount, row.totalCurrency as 'INR'),
    items: row.items.map(toOrderItem),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
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

/**
 * `orders`/`sub_orders`/`order_items` (S3-3A). Bound to `leenmart_checkout` —
 * customer-owned, no RLS, ownership enforced here by `(id, customerId)`
 * scoping, the same convention `PrismaAddressRepository` already
 * establishes for a table with no tenant concept at all.
 */
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
        addressRecipientName: order.address.recipientName,
        addressPhone: order.address.phone,
        addressLine1: order.address.line1,
        addressLine2: order.address.line2,
        addressCity: order.address.city,
        addressState: order.address.state,
        addressPincode: order.address.pincode,
        addressLandmark: order.address.landmark,
        addressLabel: order.address.label,
        createdAt: order.createdAt,
        updatedAt: order.updatedAt,
        subOrders: {
          create: order.subOrders.map((subOrder) => ({
            id: subOrder.id,
            vendorId: subOrder.vendorId,
            status: subOrder.status.name,
            vendorShopNameSnapshot: subOrder.vendorShopNameSnapshot,
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

  /**
   * Writes the order's own status, then every sub-order's — sequential
   * `update` calls on `this.prisma`, never a nested `$transaction`: this
   * method is always reached already inside `CheckoutTransactionRunner`'s
   * open transaction, and opening a second one on the same connection is
   * exactly the pitfall `runInTenantTransaction`'s own comment documents
   * for the tenant-scoped client.
   */
  async updateStatus(order: Order): Promise<void> {
    await this.prisma.order.update({
      where: { id: order.id },
      data: { status: order.status.name, updatedAt: order.updatedAt },
    });
    for (const subOrder of order.subOrders) {
      await this.prisma.subOrder.update({
        where: { id: subOrder.id },
        data: { status: subOrder.status.name, updatedAt: subOrder.updatedAt },
      });
    }
  }
}
