import { describe, expect, it } from 'vitest';
import { Money, UuidV7Generator } from '@leen-mart/domain-kit';
import { Product } from '../../../../../src/modules/catalogue/domain/entities/product.entity.js';
import { ProductVariant } from '../../../../../src/modules/catalogue/domain/entities/product-variant.entity.js';
import { toCategoryId } from '../../../../../src/modules/catalogue/domain/value-objects/category-id.value-object.js';
import { toProductId } from '../../../../../src/modules/catalogue/domain/value-objects/product-id.value-object.js';
import { toProductVariantId } from '../../../../../src/modules/catalogue/domain/value-objects/product-variant-id.value-object.js';
import { toVendorId } from '../../../../../src/modules/identity/domain/value-objects/vendor-id.value-object.js';

const ids = new UuidV7Generator();
const NOW = new Date('2026-03-01T00:00:00.000Z');
const LATER = new Date('2026-03-02T00:00:00.000Z');

const vendorId = toVendorId(ids.generate());
const categoryId = toCategoryId(ids.generate());

const product = (): Product =>
  Product.create({
    id: toProductId(ids.generate()),
    vendorId,
    categoryId,
    name: 'Fresh Rohu Fish',
    brand: null,
    description: null,
    hsnCode: null,
    countryOfOrigin: null,
    netQuantity: null,
    attributeValues: {},
    now: NOW,
  });

const variant = (): ProductVariant =>
  ProductVariant.create({
    id: toProductVariantId(ids.generate()),
    productId: toProductId(ids.generate()),
    vendorId,
    sku: 'SKU-1',
    name: 'Default',
    price: Money.fromMinor(19900n, 'INR'),
    unitOfMeasure: 'per kg',
    quantityStep: 250,
    now: NOW,
  });

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

describe('Product mutation (S2-3b)', () => {
  describe('updateDetails', () => {
    it('changes only the supplied fields', () => {
      const original = product();
      const updated = original.updateDetails({ name: 'Renamed' }, LATER);

      expect(updated.name).toBe('Renamed');
      expect(updated.categoryId).toBe(original.categoryId);
      expect(updated.brand).toBe(original.brand);
      expect(updated.updatedAt).toEqual(LATER);
    });

    it('is a no-op when nothing is supplied', () => {
      const original = product();
      const updated = original.updateDetails({}, LATER);

      expect(updated.name).toBe(original.name);
      expect(updated.attributeValues).toEqual(original.attributeValues);
    });

    it('trims and revalidates, so an edit cannot land what creation would refuse', () => {
      expect(product().updateDetails({ name: '  Spaced  ' }, LATER).name).toBe('Spaced');
      expect(issueOf(() => product().updateDetails({ name: '   ' }, LATER))).toMatch(/blank/i);
      expect(issueOf(() => product().updateDetails({ name: 'x'.repeat(201) }, LATER))).toMatch(
        /at most 200/i,
      );
      expect(issueOf(() => product().updateDetails({ hsnCode: '123456789' }, LATER))).toMatch(
        /at most 8/i,
      );
      expect(issueOf(() => product().updateDetails({ countryOfOrigin: 'IND' }, LATER))).toMatch(
        /at most 2/i,
      );
    });

    it('distinguishes clearing a nullable field from leaving it alone', () => {
      const withBrand = product().updateDetails({ brand: 'Acme' }, LATER);

      expect(withBrand.updateDetails({}, LATER).brand).toBe('Acme');
      expect(withBrand.updateDetails({ brand: null }, LATER).brand).toBeNull();
    });

    it('moves the product to another category', () => {
      const target = toCategoryId(ids.generate());

      expect(product().updateDetails({ categoryId: target }, LATER).categoryId).toBe(target);
    });

    it('never touches status, ownership or identity', () => {
      const original = product();
      const updated = original.updateDetails({ name: 'Renamed' }, LATER);

      expect(updated.id).toBe(original.id);
      expect(updated.vendorId).toBe(original.vendorId);
      expect(updated.status).toBe('DRAFT');
    });

    it('offers no mutator for status at all', () => {
      // The moderation flow that moves it does not exist yet, and a setter
      // added "for later" is a setter something will call early.
      const methods = Object.getOwnPropertyNames(Product.prototype);
      expect(methods).not.toContain('changeStatus');
      expect(methods).not.toContain('publish');
      expect(methods).not.toContain('submit');
    });
  });

  describe('softDelete', () => {
    it('stamps deletedAt and reports itself deleted', () => {
      const deleted = product().softDelete(NOW);

      expect(deleted.deletedAt).toEqual(NOW);
      expect(deleted.isDeleted).toBe(true);
    });

    it('refuses every further operation once deleted', () => {
      const deleted = product().softDelete(NOW);

      expect(issueOf(() => deleted.updateDetails({ name: 'x' }, LATER))).toMatch(/deleted/i);
      expect(issueOf(() => deleted.softDelete(LATER))).toMatch(/deleted/i);
    });
  });
});

describe('ProductVariant mutation (S2-3b)', () => {
  describe('updateDetails', () => {
    it('changes only the supplied fields', () => {
      const original = variant();
      const updated = original.updateDetails({ name: 'Renamed' }, LATER);

      expect(updated.name).toBe('Renamed');
      expect(updated.price.amountMinor).toBe(original.price.amountMinor);
      expect(updated.quantityStep).toBe(original.quantityStep);
      expect(updated.updatedAt).toEqual(LATER);
    });

    it('changes the price and the unit of measure', () => {
      const updated = variant().updateDetails(
        { price: Money.fromMinor(50000n, 'INR'), unitOfMeasure: 'per piece' },
        LATER,
      );

      expect(updated.price.amountMinor).toBe(50000n);
      expect(updated.unitOfMeasure).toBe('per piece');
    });

    it('revalidates, so an edit cannot land what creation would refuse', () => {
      expect(issueOf(() => variant().updateDetails({ name: '  ' }, LATER))).toMatch(/blank/i);
      expect(
        issueOf(() => variant().updateDetails({ price: Money.fromMinor(-1n, 'INR') }, LATER)),
      ).toMatch(/negative/i);
      expect(issueOf(() => variant().updateDetails({ quantityStep: 0 }, LATER))).toMatch(
        /positive integer/i,
      );
      expect(issueOf(() => variant().updateDetails({ quantityStep: 1.5 }, LATER))).toMatch(
        /positive integer/i,
      );
    });

    it('never touches the SKU, its product or its vendor', () => {
      const original = variant();
      const updated = original.updateDetails({ name: 'Renamed' }, LATER);

      expect(updated.sku).toBe(original.sku);
      expect(updated.productId).toBe(original.productId);
      expect(updated.vendorId).toBe(original.vendorId);
    });

    it('offers no SKU mutator — S2-3a’s decision, preserved', () => {
      const methods = Object.getOwnPropertyNames(ProductVariant.prototype);

      expect(methods).not.toContain('changeSku');
      expect(methods).not.toContain('rekey');
      expect(methods).not.toContain('setSku');
    });
  });

  describe('softDelete', () => {
    it('stamps deletedAt', () => {
      expect(variant().softDelete(NOW).deletedAt).toEqual(NOW);
    });

    it('does not judge whether it is the last one — that is a question about other rows', () => {
      // `softDeleteIfNotLast`'s job, settled against the database under the
      // parent product's lock.
      expect(() => variant().softDelete(NOW)).not.toThrow();
    });

    it('refuses every further operation once deleted', () => {
      const deleted = variant().softDelete(NOW);

      expect(issueOf(() => deleted.updateDetails({ name: 'x' }, LATER))).toMatch(/deleted/i);
      expect(issueOf(() => deleted.softDelete(LATER))).toMatch(/deleted/i);
    });
  });
});
