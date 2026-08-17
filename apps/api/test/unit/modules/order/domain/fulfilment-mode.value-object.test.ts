import { describe, expect, it } from 'vitest';
import { FulfilmentMode } from '../../../../../src/modules/order/domain/value-objects/fulfilment-mode.value-object.js';

const NAMES = ['DELIVERY', 'PICKUP'] as const;

describe('FulfilmentMode', () => {
  it('exposes exactly the two S4-QR fulfilment modes', () => {
    for (const name of NAMES) {
      expect(FulfilmentMode.fromName(name).name).toBe(name);
    }
  });

  it.each(NAMES)('resolves %s to the matching singleton', (name) => {
    expect(FulfilmentMode.fromName(name)).toBe(FulfilmentMode.fromName(name));
  });

  it('rejects an unknown mode name', () => {
    expect(() => FulfilmentMode.fromName('PICKUP_IN_STORE')).toThrow(/Not a valid fulfilment mode/);
  });

  it('rejects an OrderStatus-shaped name that is not a fulfilment mode', () => {
    expect(() => FulfilmentMode.fromName('PROCESSING')).toThrow(/Not a valid fulfilment mode/);
  });

  it('compares modes by name', () => {
    expect(FulfilmentMode.DELIVERY.equals(FulfilmentMode.fromName('DELIVERY'))).toBe(true);
    expect(FulfilmentMode.DELIVERY.equals(FulfilmentMode.PICKUP)).toBe(false);
  });
});
