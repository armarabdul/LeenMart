import { describe, expect, it } from 'vitest';
import { UuidV7Generator } from '@leen-mart/domain-kit';
import { toVendorId } from '../../../../../src/modules/identity/index.js';
import { Product } from '../../../../../src/modules/catalogue/domain/entities/product.entity.js';
import { InvalidProductOperationError } from '../../../../../src/modules/catalogue/domain/errors/catalogue-errors.js';
import { toCategoryId } from '../../../../../src/modules/catalogue/domain/value-objects/category-id.value-object.js';
import { toProductId } from '../../../../../src/modules/catalogue/domain/value-objects/product-id.value-object.js';

const ids = new UuidV7Generator();
const NOW = new Date('2026-03-01T00:00:00.000Z');
const vendorId = toVendorId(ids.generate());
const categoryId = toCategoryId(ids.generate());

interface Overrides {
  name?: string;
  brand?: string | null;
  hsnCode?: string | null;
  countryOfOrigin?: string | null;
  netQuantity?: string | null;
}

const make = (overrides: Overrides = {}): Product =>
  Product.create({
    id: toProductId(ids.generate()),
    vendorId,
    categoryId,
    name: overrides.name ?? 'Fresh Rohu Fish',
    brand: overrides.brand ?? null,
    description: null,
    hsnCode: overrides.hsnCode ?? null,
    countryOfOrigin: overrides.countryOfOrigin ?? null,
    netQuantity: overrides.netQuantity ?? null,
    attributeValues: {},
    now: NOW,
  });

const issueOf = (act: () => unknown): string => {
  try {
    act();
    return 'did not throw';
  } catch (error) {
    const failure = error as { details?: { field: string; issue: string }[] };
    return failure.details?.[0]?.issue ?? 'no detail';
  }
};

describe('Product', () => {
  it('starts in DRAFT', () => {
    expect(make().status).toBe('DRAFT');
  });

  it('is not deleted on creation', () => {
    const product = make();
    expect(product.isDeleted).toBe(false);
    expect(product.deletedAt).toBeNull();
  });

  it('trims the name', () => {
    expect(make({ name: '  Fresh Rohu Fish  ' }).name).toBe('Fresh Rohu Fish');
  });

  it('refuses a blank name', () => {
    expect(() => make({ name: '   ' })).toThrow(InvalidProductOperationError);
    expect(issueOf(() => make({ name: '' }))).toBe('Must not be blank.');
  });

  it('refuses a name over 200 characters', () => {
    expect(() => make({ name: 'x'.repeat(201) })).toThrow(InvalidProductOperationError);
  });

  it('accepts a name at exactly the length limit', () => {
    expect(() => make({ name: 'x'.repeat(200) })).not.toThrow();
  });

  it('leaves brand/hsnCode/countryOfOrigin/netQuantity null when not supplied', () => {
    const product = make();
    expect(product.brand).toBeNull();
    expect(product.hsnCode).toBeNull();
    expect(product.countryOfOrigin).toBeNull();
    expect(product.netQuantity).toBeNull();
  });

  it('trims the statutory fields when supplied', () => {
    const product = make({ hsnCode: ' 0302 ', countryOfOrigin: ' IN ', netQuantity: ' 250 g ' });
    expect(product.hsnCode).toBe('0302');
    expect(product.countryOfOrigin).toBe('IN');
    expect(product.netQuantity).toBe('250 g');
  });

  it('refuses an hsnCode over 8 characters', () => {
    expect(() => make({ hsnCode: '123456789' })).toThrow(InvalidProductOperationError);
  });

  it('refuses a countryOfOrigin over 2 characters', () => {
    expect(() => make({ countryOfOrigin: 'IND' })).toThrow(InvalidProductOperationError);
  });

  it('refuses a netQuantity over 40 characters', () => {
    expect(() => make({ netQuantity: 'x'.repeat(41) })).toThrow(InvalidProductOperationError);
  });

  it('does not validate statutory fields against a category (S2-3 D-2) — any shape-valid value is accepted', () => {
    // No CategoryRequirements are consulted here at all; this is the whole
    // point of D-2. Presence or absence of hsnCode is never itself an error.
    expect(() => make({ hsnCode: null })).not.toThrow();
    expect(() => make({ hsnCode: '0302' })).not.toThrow();
  });

  it('stores attribute values opaquely, without validating them against category attribute definitions', () => {
    const product = Product.create({
      id: toProductId(ids.generate()),
      vendorId,
      categoryId,
      name: 'Test product',
      brand: null,
      description: null,
      hsnCode: null,
      countryOfOrigin: null,
      netQuantity: null,
      attributeValues: { weight: '250g', color: 'red', isOrganic: true },
      now: NOW,
    });
    expect(product.attributeValues).toEqual({ weight: '250g', color: 'red', isOrganic: true });
  });
});
