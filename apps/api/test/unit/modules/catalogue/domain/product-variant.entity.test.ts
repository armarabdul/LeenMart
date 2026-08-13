import { describe, expect, it } from 'vitest';
import { Money, UuidV7Generator } from '@leen-mart/domain-kit';
import { toVendorId } from '../../../../../src/modules/identity/index.js';
import { ProductVariant } from '../../../../../src/modules/catalogue/domain/entities/product-variant.entity.js';
import { InvalidProductOperationError } from '../../../../../src/modules/catalogue/domain/errors/catalogue-errors.js';
import { toProductId } from '../../../../../src/modules/catalogue/domain/value-objects/product-id.value-object.js';
import { toProductVariantId } from '../../../../../src/modules/catalogue/domain/value-objects/product-variant-id.value-object.js';
import {
  isSku,
  toSku,
} from '../../../../../src/modules/catalogue/domain/value-objects/sku.value-object.js';

const ids = new UuidV7Generator();
const NOW = new Date('2026-03-01T00:00:00.000Z');
const vendorId = toVendorId(ids.generate());
const productId = toProductId(ids.generate());

interface Overrides {
  sku?: string;
  name?: string;
  price?: Money;
  unitOfMeasure?: string;
  quantityStep?: number;
}

const make = (overrides: Overrides = {}): ProductVariant =>
  ProductVariant.create({
    id: toProductVariantId(ids.generate()),
    productId,
    vendorId,
    sku: overrides.sku ?? 'ROHU-1KG',
    name: overrides.name ?? '1 kg pack',
    price: overrides.price ?? Money.fromMajor(199),
    unitOfMeasure: overrides.unitOfMeasure ?? 'kg',
    quantityStep: overrides.quantityStep ?? 1,
    now: NOW,
  });

describe('Sku', () => {
  it('accepts a non-empty value at or under 64 characters', () => {
    expect(isSku('SKU-001')).toBe(true);
    expect(isSku('x'.repeat(64))).toBe(true);
  });

  it('rejects an empty value and a value over 64 characters', () => {
    expect(isSku('')).toBe(false);
    expect(isSku('x'.repeat(65))).toBe(false);
  });

  it('trims via toSku', () => {
    expect(toSku('  SKU-001  ')).toBe('SKU-001');
  });

  it('throws on a blank or oversized value', () => {
    expect(() => toSku('   ')).toThrow(TypeError);
    expect(() => toSku('x'.repeat(65))).toThrow(TypeError);
  });

  it('imposes no format beyond length (S2-3 D-5) — punctuation, spaces after trim, mixed case all pass', () => {
    expect(() => toSku('sku_001/v2 (blue)')).not.toThrow();
  });
});

describe('ProductVariant', () => {
  it('is not deleted on creation', () => {
    const variant = make();
    expect(variant.isDeleted).toBe(false);
    expect(variant.deletedAt).toBeNull();
  });

  it('trims sku and name', () => {
    const variant = make({ sku: '  ROHU-1KG  ', name: '  1 kg pack  ' });
    expect(variant.sku).toBe('ROHU-1KG');
    expect(variant.name).toBe('1 kg pack');
  });

  it('refuses a blank name', () => {
    expect(() => make({ name: '   ' })).toThrow(InvalidProductOperationError);
  });

  it('refuses a name over 120 characters', () => {
    expect(() => make({ name: 'x'.repeat(121) })).toThrow(InvalidProductOperationError);
  });

  it('stores unitOfMeasure as free text, with no closed vocabulary (S2-3 D-3)', () => {
    expect(make({ unitOfMeasure: 'per kg' }).unitOfMeasure).toBe('per kg');
    expect(make({ unitOfMeasure: '250g steps' }).unitOfMeasure).toBe('250g steps');
    expect(make({ unitOfMeasure: 'piece' }).unitOfMeasure).toBe('piece');
  });

  it('refuses a blank unitOfMeasure', () => {
    expect(() => make({ unitOfMeasure: '   ' })).toThrow(InvalidProductOperationError);
  });

  it('refuses a unitOfMeasure over 40 characters', () => {
    expect(() => make({ unitOfMeasure: 'x'.repeat(41) })).toThrow(InvalidProductOperationError);
  });

  it('refuses a negative price', () => {
    expect(() => make({ price: Money.fromMinor(-1) })).toThrow(InvalidProductOperationError);
  });

  it('accepts a zero price', () => {
    expect(() => make({ price: Money.zero() })).not.toThrow();
  });

  it('refuses a non-positive quantityStep', () => {
    expect(() => make({ quantityStep: 0 })).toThrow(InvalidProductOperationError);
    expect(() => make({ quantityStep: -1 })).toThrow(InvalidProductOperationError);
  });

  it('refuses a non-integer quantityStep', () => {
    expect(() => make({ quantityStep: 1.5 })).toThrow(InvalidProductOperationError);
  });

  it('accepts a positive integer quantityStep', () => {
    expect(() => make({ quantityStep: 250 })).not.toThrow();
  });

  it('carries price as a Money value object, in integer minor units', () => {
    const variant = make({ price: Money.fromMajor(199) });
    expect(variant.price.amountMinor).toBe(19900n);
    expect(variant.price.currency).toBe('INR');
  });
});
