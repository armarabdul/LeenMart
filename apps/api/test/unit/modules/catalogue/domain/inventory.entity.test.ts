import { describe, expect, it } from 'vitest';
import { UuidV7Generator } from '@leen-mart/domain-kit';
import {
  INITIAL_INVENTORY_VERSION,
  Inventory,
} from '../../../../../src/modules/catalogue/domain/entities/inventory.entity.js';
import { toProductVariantId } from '../../../../../src/modules/catalogue/domain/value-objects/product-variant-id.value-object.js';
import { toVendorId } from '../../../../../src/modules/identity/domain/value-objects/vendor-id.value-object.js';

const ids = new UuidV7Generator();
const NOW = new Date('2026-03-01T00:00:00.000Z');
const LATER = new Date('2026-03-02T00:00:00.000Z');

const variantId = toProductVariantId(ids.generate());
const vendorId = toVendorId(ids.generate());

const initial = (): Inventory => Inventory.initial({ variantId, vendorId, now: NOW });

/** Domain-rule messages are uniform (SEC-15); what names the broken rule is `details`. */
const issueOf = (act: () => unknown): string => {
  try {
    act();
    return 'did not throw';
  } catch (error) {
    const failure = error as { details?: { field: string; issue: string }[] };
    return failure.details?.[0]?.issue ?? 'no detail';
  }
};

describe('Inventory', () => {
  describe('initial', () => {
    it('starts empty, unreserved and at version 1', () => {
      const inventory = initial();

      expect(inventory.available).toBe(0);
      expect(inventory.reserved).toBe(0);
      expect(inventory.version).toBe(INITIAL_INVENTORY_VERSION);
      expect(inventory.version).toBe(1);
    });

    it('belongs to the variant and vendor it was created for', () => {
      const inventory = initial();

      expect(inventory.variantId).toBe(variantId);
      expect(inventory.vendorId).toBe(vendorId);
    });

    it('stamps both timestamps from the supplied clock', () => {
      const inventory = initial();

      expect(inventory.createdAt).toEqual(NOW);
      expect(inventory.updatedAt).toEqual(NOW);
    });
  });

  describe('set', () => {
    it('replaces the available figure absolutely, not relatively', () => {
      const inventory = initial().set(50, LATER);

      expect(inventory.available).toBe(50);
      expect(inventory.set(20, LATER).available).toBe(20);
    });

    it('advances the version by exactly one', () => {
      const first = initial().set(10, LATER);
      const second = first.set(20, LATER);

      expect(first.version).toBe(2);
      expect(second.version).toBe(3);
    });

    it('never touches reserved — that belongs to the reservation flow', () => {
      const inventory = initial().set(50, LATER);

      expect(inventory.reserved).toBe(0);
    });

    it('accepts zero, which is how a vendor marks something out of stock', () => {
      expect(initial().set(10, LATER).set(0, LATER).available).toBe(0);
    });

    it.each([-1, 1.5, Number.NaN])('refuses %s', (value) => {
      expect(issueOf(() => initial().set(value, LATER))).toMatch(/whole number of zero or more/i);
    });

    it('stamps updatedAt but leaves createdAt alone', () => {
      const inventory = initial().set(5, LATER);

      expect(inventory.updatedAt).toEqual(LATER);
      expect(inventory.createdAt).toEqual(NOW);
    });

    it('leaves the original untouched', () => {
      const original = initial();
      original.set(99, LATER);

      expect(original.available).toBe(0);
      expect(original.version).toBe(1);
    });
  });

  describe('what it deliberately cannot do', () => {
    it('offers no reserve or release — that is Stage 3, under a different statement', () => {
      // SDD 14.4 prescribes a single atomic conditional UPDATE for the
      // checkout decrement. Routing it through this entity's version guard
      // would make concurrent buyers collide with each other rather than with
      // the stock figure.
      const methods = Object.getOwnPropertyNames(Inventory.prototype);

      expect(methods).not.toContain('reserve');
      expect(methods).not.toContain('release');
      expect(methods).not.toContain('decrement');
      expect(methods).not.toContain('increment');
    });

    it('offers no way to move the vendor or the variant it belongs to', () => {
      const methods = Object.getOwnPropertyNames(Inventory.prototype);

      expect(methods).not.toContain('changeVendor');
      expect(methods).not.toContain('changeVariant');
    });

    it('does not decide whether its own write will land', () => {
      // The version guard is the repository's conditional `WHERE`; an
      // aggregate holding only its own state cannot know whether someone else
      // moved first.
      const inventory = initial();

      expect(() => inventory.set(10, LATER)).not.toThrow();
      expect(inventory.set(10, LATER).version).toBe(2);
    });
  });
});
