import { describe, expect, it, vi } from 'vitest';
import type { Response } from 'express';
import { UuidV7Generator } from '@leen-mart/domain-kit';
import { toVendorId } from '../../../../../src/modules/identity/index.js';
import { VendorStreamRegistry } from '../../../../../src/modules/order/infrastructure/realtime/vendor-stream-registry.js';

const ids = new UuidV7Generator();

const fakeResponse = (): Response & { write: ReturnType<typeof vi.fn> } =>
  ({ write: vi.fn() }) as unknown as Response & { write: ReturnType<typeof vi.fn> };

describe('VendorStreamRegistry', () => {
  it('publishLocal writes an SSE frame to a registered connection', () => {
    const registry = new VendorStreamRegistry();
    const vendorId = toVendorId(ids.generate());
    const res = fakeResponse();
    registry.register(vendorId, res);

    registry.publishLocal(vendorId, { type: 'order.placed', data: { orderId: 'abc' } });

    expect(res.write).toHaveBeenCalledWith('event: order.placed\n');
    expect(res.write).toHaveBeenCalledWith('data: {"orderId":"abc"}\n\n');
  });

  it('is a no-op for a vendor with no registered connection', () => {
    const registry = new VendorStreamRegistry();
    const vendorId = toVendorId(ids.generate());

    expect(() => registry.publishLocal(vendorId, { type: 'order.placed', data: {} })).not.toThrow();
  });

  it('delivers to every connection registered for the same vendor', () => {
    const registry = new VendorStreamRegistry();
    const vendorId = toVendorId(ids.generate());
    const resA = fakeResponse();
    const resB = fakeResponse();
    registry.register(vendorId, resA);
    registry.register(vendorId, resB);

    registry.publishLocal(vendorId, { type: 'order.placed', data: {} });

    expect(resA.write).toHaveBeenCalled();
    expect(resB.write).toHaveBeenCalled();
    expect(registry.connectionCountFor(vendorId)).toBe(2);
  });

  it('never delivers to a different vendor’s connection', () => {
    const registry = new VendorStreamRegistry();
    const vendorA = toVendorId(ids.generate());
    const vendorB = toVendorId(ids.generate());
    const resB = fakeResponse();
    registry.register(vendorB, resB);

    registry.publishLocal(vendorA, { type: 'order.placed', data: {} });

    expect(resB.write).not.toHaveBeenCalled();
  });

  it('unregister() removes exactly the connection it was returned for', () => {
    const registry = new VendorStreamRegistry();
    const vendorId = toVendorId(ids.generate());
    const resA = fakeResponse();
    const resB = fakeResponse();
    const unregisterA = registry.register(vendorId, resA);
    registry.register(vendorId, resB);

    unregisterA();
    registry.publishLocal(vendorId, { type: 'order.placed', data: {} });

    expect(resA.write).not.toHaveBeenCalled();
    expect(resB.write).toHaveBeenCalled();
    expect(registry.connectionCountFor(vendorId)).toBe(1);
  });

  it('deletes the vendor entry entirely once its last connection unregisters — no leaked map entries', () => {
    const registry = new VendorStreamRegistry();
    const vendorId = toVendorId(ids.generate());
    const unregister = registry.register(vendorId, fakeResponse());

    expect(registry.hasVendor(vendorId)).toBe(true);
    unregister();
    expect(registry.hasVendor(vendorId)).toBe(false);
    expect(registry.connectionCountFor(vendorId)).toBe(0);
  });

  it('unregistering twice is safe (idempotent close, e.g. a duplicate "close" event)', () => {
    const registry = new VendorStreamRegistry();
    const vendorId = toVendorId(ids.generate());
    const unregister = registry.register(vendorId, fakeResponse());

    unregister();
    expect(() => unregister()).not.toThrow();
    expect(registry.hasVendor(vendorId)).toBe(false);
  });
});
