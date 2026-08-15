import { describe, expect, it } from 'vitest';
import { Money, toUuid } from '@leen-mart/domain-kit';
import { Order } from '../../../../../src/modules/order/domain/entities/order.entity.js';
import { SubOrder } from '../../../../../src/modules/order/domain/entities/sub-order.entity.js';
import {
  InvalidOrderStatusTransitionError,
  OrderCancellationNotAllowedError,
} from '../../../../../src/modules/order/domain/errors/order-errors.js';
import { OrderStatus } from '../../../../../src/modules/order/domain/value-objects/order-status.value-object.js';
import { toOrderId } from '../../../../../src/modules/order/domain/value-objects/order-id.value-object.js';
import { toSubOrderId } from '../../../../../src/modules/order/domain/value-objects/sub-order-id.value-object.js';
import { toUserId } from '../../../../../src/modules/identity/domain/value-objects/user-id.value-object.js';
import { toVendorId } from '../../../../../src/modules/identity/domain/value-objects/vendor-id.value-object.js';

const orderId = toOrderId('00000000-0000-7000-8000-000000000b01');
const customerId = toUserId('00000000-0000-7000-8000-000000000b02');
const vendorAId = toVendorId('00000000-0000-7000-8000-000000000b03');
const vendorBId = toVendorId('00000000-0000-7000-8000-000000000b04');
const now = new Date('2026-01-01T00:00:00.000Z');
const later = new Date('2026-01-02T00:00:00.000Z');

const address = {
  recipientName: 'Asha Rao',
  phone: '+919876543210',
  line1: '221B Baker Street',
  line2: null,
  city: 'Bengaluru',
  state: 'Karnataka',
  pincode: '560001',
  landmark: null,
  label: 'Home',
};

const subOrderInState = (
  status: OrderStatus,
  vendorId = vendorAId,
  id = toSubOrderId(toUuid('00000000-0000-7000-8000-000000000b05')),
): SubOrder =>
  SubOrder.reconstitute({
    id,
    orderId,
    vendorId,
    status,
    vendorShopNameSnapshot: 'Test Shop',
    totalAmount: Money.fromMajor(100),
    items: [],
    createdAt: now,
    updatedAt: now,
  });

const orderInState = (
  status: OrderStatus,
  subOrders: readonly SubOrder[] = [subOrderInState(status)],
): Order =>
  Order.reconstitute({
    id: orderId,
    customerId,
    status,
    totalAmount: Money.fromMajor(100),
    address,
    subOrders,
    createdAt: now,
    updatedAt: now,
  });

describe('Order', () => {
  describe('place', () => {
    it('always starts PENDING_PAYMENT, per decision D-S3-06', () => {
      const order = Order.place({
        id: orderId,
        customerId,
        totalAmount: Money.fromMajor(100),
        address,
        subOrders: [],
        now,
      });

      expect(order.status).toBe(OrderStatus.PENDING_PAYMENT);
    });

    it('stamps both timestamps at placement', () => {
      const order = Order.place({
        id: orderId,
        customerId,
        totalAmount: Money.fromMajor(100),
        address,
        subOrders: [],
        now,
      });

      expect(order.createdAt).toEqual(now);
      expect(order.updatedAt).toEqual(now);
    });
  });

  describe('legal transitions', () => {
    it('confirm() moves PENDING_PAYMENT -> CONFIRMED', () => {
      const confirmed = orderInState(OrderStatus.PENDING_PAYMENT).confirm(later);
      expect(confirmed.status).toBe(OrderStatus.CONFIRMED);
      expect(confirmed.updatedAt).toEqual(later);
    });

    it('never mutates the receiver', () => {
      const original = orderInState(OrderStatus.PENDING_PAYMENT);
      const confirmed = original.confirm(later);
      expect(confirmed).not.toBe(original);
      expect(original.status).toBe(OrderStatus.PENDING_PAYMENT);
    });
  });

  describe('illegal transitions', () => {
    it('refuses confirm() from CONFIRMED', () => {
      expect(() => orderInState(OrderStatus.CONFIRMED).confirm(later)).toThrow(
        InvalidOrderStatusTransitionError,
      );
    });

    it('refuses confirm() from CANCELLED', () => {
      expect(() =>
        orderInState(OrderStatus.CANCELLED, [subOrderInState(OrderStatus.CANCELLED)]).confirm(
          later,
        ),
      ).toThrow(InvalidOrderStatusTransitionError);
    });

    it('reports a 422-mapped domain rule with both states named', () => {
      try {
        orderInState(OrderStatus.CONFIRMED).confirm(later);
        expect.unreachable('confirm() from CONFIRMED should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(InvalidOrderStatusTransitionError);
        const failure = error as InvalidOrderStatusTransitionError;
        expect(failure.kind).toBe('DOMAIN_RULE');
        expect(failure.code).toBe('ORDER_INVALID_STATUS_TRANSITION');
        expect(failure.message).toMatch(/CONFIRMED to CONFIRMED/);
      }
    });
  });

  describe('canBeCancelledByCustomer (approved decision: "permitted only while the order has not reached PROCESSING")', () => {
    it('is cancellable while PENDING_PAYMENT', () => {
      expect(orderInState(OrderStatus.PENDING_PAYMENT).canBeCancelledByCustomer()).toBe(true);
    });

    it('is cancellable while CONFIRMED, with its sub-order also merely CONFIRMED', () => {
      expect(
        orderInState(OrderStatus.CONFIRMED, [
          subOrderInState(OrderStatus.CONFIRMED),
        ]).canBeCancelledByCustomer(),
      ).toBe(true);
    });

    it('is NOT cancellable once the order itself is PROCESSING', () => {
      expect(
        orderInState(OrderStatus.PROCESSING, [
          subOrderInState(OrderStatus.PROCESSING),
        ]).canBeCancelledByCustomer(),
      ).toBe(false);
    });

    it('is NOT cancellable once already CANCELLED', () => {
      expect(
        orderInState(OrderStatus.CANCELLED, [
          subOrderInState(OrderStatus.CANCELLED),
        ]).canBeCancelledByCustomer(),
      ).toBe(false);
    });

    it('is NOT cancellable if even one of several sub-orders has reached PROCESSING (conservative, whole-order rule)', () => {
      const order = orderInState(OrderStatus.CONFIRMED, [
        subOrderInState(
          OrderStatus.CONFIRMED,
          vendorAId,
          toSubOrderId('00000000-0000-7000-8000-000000000b10'),
        ),
        subOrderInState(
          OrderStatus.PROCESSING,
          vendorBId,
          toSubOrderId('00000000-0000-7000-8000-000000000b11'),
        ),
      ]);

      expect(order.canBeCancelledByCustomer()).toBe(false);
    });

    it('is cancellable when every sub-order is still PENDING_PAYMENT/CONFIRMED', () => {
      const order = orderInState(OrderStatus.CONFIRMED, [
        subOrderInState(
          OrderStatus.CONFIRMED,
          vendorAId,
          toSubOrderId('00000000-0000-7000-8000-000000000b12'),
        ),
        subOrderInState(
          OrderStatus.PENDING_PAYMENT,
          vendorBId,
          toSubOrderId('00000000-0000-7000-8000-000000000b13'),
        ),
      ]);

      expect(order.canBeCancelledByCustomer()).toBe(true);
    });
  });

  describe('cancel()', () => {
    it('cancels the order and every sub-order together', () => {
      const order = orderInState(OrderStatus.CONFIRMED, [
        subOrderInState(
          OrderStatus.CONFIRMED,
          vendorAId,
          toSubOrderId('00000000-0000-7000-8000-000000000b20'),
        ),
        subOrderInState(
          OrderStatus.PENDING_PAYMENT,
          vendorBId,
          toSubOrderId('00000000-0000-7000-8000-000000000b21'),
        ),
      ]);

      const cancelled = order.cancel(later);

      expect(cancelled.status).toBe(OrderStatus.CANCELLED);
      expect(cancelled.subOrders.every((subOrder) => subOrder.status.name === 'CANCELLED')).toBe(
        true,
      );
      expect(cancelled.updatedAt).toEqual(later);
    });

    it('refuses to cancel once PROCESSING has been reached', () => {
      const order = orderInState(OrderStatus.PROCESSING, [subOrderInState(OrderStatus.PROCESSING)]);

      expect(() => order.cancel(later)).toThrow(OrderCancellationNotAllowedError);
    });

    it('refuses to cancel an already-CANCELLED order', () => {
      const order = orderInState(OrderStatus.CANCELLED, [subOrderInState(OrderStatus.CANCELLED)]);

      expect(() => order.cancel(later)).toThrow(OrderCancellationNotAllowedError);
    });

    it('reports cancellation refusal as a 422-mapped domain rule', () => {
      const order = orderInState(OrderStatus.PROCESSING, [subOrderInState(OrderStatus.PROCESSING)]);
      try {
        order.cancel(later);
        expect.unreachable('cancel() should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(OrderCancellationNotAllowedError);
        expect((error as OrderCancellationNotAllowedError).kind).toBe('DOMAIN_RULE');
        expect((error as OrderCancellationNotAllowedError).code).toBe(
          'ORDER_CANCELLATION_NOT_ALLOWED',
        );
      }
    });

    it('never mutates the receiver', () => {
      const original = orderInState(OrderStatus.PENDING_PAYMENT);
      const cancelled = original.cancel(later);
      expect(cancelled).not.toBe(original);
      expect(original.status).toBe(OrderStatus.PENDING_PAYMENT);
    });
  });
});

describe('SubOrder', () => {
  it('open() always starts PENDING_PAYMENT', () => {
    const subOrder = SubOrder.open({
      id: toSubOrderId('00000000-0000-7000-8000-000000000b30'),
      orderId,
      vendorId: vendorAId,
      vendorShopNameSnapshot: 'Test Shop',
      totalAmount: Money.fromMajor(50),
      items: [],
      now,
    });

    expect(subOrder.status).toBe(OrderStatus.PENDING_PAYMENT);
  });

  it('confirm() moves PENDING_PAYMENT -> CONFIRMED', () => {
    const confirmed = subOrderInState(OrderStatus.PENDING_PAYMENT).confirm(later);
    expect(confirmed.status).toBe(OrderStatus.CONFIRMED);
  });

  it('startProcessing() moves CONFIRMED -> PROCESSING', () => {
    const processing = subOrderInState(OrderStatus.CONFIRMED).startProcessing(later);
    expect(processing.status).toBe(OrderStatus.PROCESSING);
  });

  it('refuses startProcessing() from PENDING_PAYMENT (must be confirmed first)', () => {
    expect(() => subOrderInState(OrderStatus.PENDING_PAYMENT).startProcessing(later)).toThrow(
      InvalidOrderStatusTransitionError,
    );
  });

  it('cancel() refuses once PROCESSING', () => {
    expect(() => subOrderInState(OrderStatus.PROCESSING).cancel(later)).toThrow(
      InvalidOrderStatusTransitionError,
    );
  });

  it('cancel() is legal from PENDING_PAYMENT and CONFIRMED', () => {
    expect(subOrderInState(OrderStatus.PENDING_PAYMENT).cancel(later).status).toBe(
      OrderStatus.CANCELLED,
    );
    expect(subOrderInState(OrderStatus.CONFIRMED).cancel(later).status).toBe(OrderStatus.CANCELLED);
  });
});
