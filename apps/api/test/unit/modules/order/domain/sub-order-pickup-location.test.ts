import { describe, expect, it } from 'vitest';
import { Money, UuidV7Generator } from '@leen-mart/domain-kit';
import { toVendorId } from '../../../../../src/modules/identity/domain/value-objects/vendor-id.value-object.js';
import { SubOrder } from '../../../../../src/modules/order/domain/entities/sub-order.entity.js';
import { FulfilmentMode } from '../../../../../src/modules/order/domain/value-objects/fulfilment-mode.value-object.js';
import { FulfilmentModeMismatchError } from '../../../../../src/modules/order/domain/errors/order-errors.js';
import { toOrderId } from '../../../../../src/modules/order/domain/value-objects/order-id.value-object.js';
import { toSubOrderId } from '../../../../../src/modules/order/domain/value-objects/sub-order-id.value-object.js';

const ids = new UuidV7Generator();
const NOW = new Date('2026-08-01T00:00:00.000Z');

const LOCATION = {
  line1: '12 Market Road',
  line2: null,
  city: 'Bengaluru',
  state: 'Karnataka',
  pincode: '560001',
};

const open = (
  fulfilmentMode: FulfilmentMode,
  pickupLocationSnapshot: typeof LOCATION | null = null,
): SubOrder =>
  SubOrder.open({
    id: toSubOrderId(ids.generate()),
    orderId: toOrderId(ids.generate()),
    vendorId: toVendorId(ids.generate()),
    fulfilmentMode,
    vendorShopNameSnapshot: 'FreshMart',
    pickupLocationSnapshot,
    totalAmount: Money.fromMajor(499),
    items: [],
    now: NOW,
  });

describe('SubOrder pickup-location snapshot (S4-ADDR)', () => {
  it('carries the snapshot on a PICKUP sub-order', () => {
    expect(open(FulfilmentMode.PICKUP, LOCATION).pickupLocationSnapshot).toEqual(LOCATION);
  });

  it('is null on a DELIVERY sub-order', () => {
    expect(open(FulfilmentMode.DELIVERY).pickupLocationSnapshot).toBeNull();
  });

  it('is null on a PICKUP sub-order whose vendor had set no address', () => {
    expect(open(FulfilmentMode.PICKUP).pickupLocationSnapshot).toBeNull();
  });

  it('refuses a collection address on a DELIVERY sub-order', () => {
    // A delivery sub-order with a pickup location is a contradiction; the
    // entity refuses to hold one rather than storing it and hoping every
    // read path remembers to ignore it.
    expect(() => open(FulfilmentMode.DELIVERY, LOCATION)).toThrow(FulfilmentModeMismatchError);
  });

  it('is not changed by any status transition', () => {
    const subOrder = open(FulfilmentMode.PICKUP, LOCATION);
    const readied = subOrder.confirm(NOW).startProcessing(NOW).markReadyForPickup(NOW);

    expect(readied.pickupLocationSnapshot).toEqual(LOCATION);
    expect(readied.completePickup(NOW).pickupLocationSnapshot).toEqual(LOCATION);
  });
});
