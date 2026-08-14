import { describe, expect, it } from 'vitest';
import { UuidV7Generator } from '@leen-mart/domain-kit';
import { CartItem } from '../../../../../src/modules/cart/domain/entities/cart-item.entity.js';
import { InvalidCartQuantityError } from '../../../../../src/modules/cart/domain/errors/cart-errors.js';
import { toCartId } from '../../../../../src/modules/cart/domain/value-objects/cart-id.value-object.js';
import { toCartItemId } from '../../../../../src/modules/cart/domain/value-objects/cart-item-id.value-object.js';
import { toProductVariantId } from '../../../../../src/modules/catalogue/domain/value-objects/product-variant-id.value-object.js';

const ids = new UuidV7Generator();
const NOW = new Date('2026-08-14T00:00:00.000Z');
const cartId = toCartId(ids.generate());
const variantId = toProductVariantId(ids.generate());

const build = (quantity: number): CartItem =>
  CartItem.add({ id: toCartItemId(ids.generate()), cartId, variantId, quantity, now: NOW });

describe('CartItem', () => {
  it('add() accepts a positive integer quantity', () => {
    const item = build(3);
    expect(item.quantity).toBe(3);
    expect(item.cartId).toBe(cartId);
    expect(item.variantId).toBe(variantId);
  });

  it('add() rejects a zero quantity', () => {
    expect(() => build(0)).toThrow(InvalidCartQuantityError);
  });

  it('add() rejects a negative quantity', () => {
    expect(() => build(-1)).toThrow(InvalidCartQuantityError);
  });

  it('add() rejects a non-integer quantity', () => {
    expect(() => build(1.5)).toThrow(InvalidCartQuantityError);
  });

  it('changeQuantity() returns a new instance with the updated quantity and updatedAt', () => {
    const item = build(2);
    const later = new Date('2026-08-15T00:00:00.000Z');
    const updated = item.changeQuantity(5, later);
    expect(updated.quantity).toBe(5);
    expect(updated.updatedAt).toEqual(later);
    // Original is untouched — immutable, transition-method style.
    expect(item.quantity).toBe(2);
  });

  it('changeQuantity() rejects an invalid quantity the same way add() does', () => {
    const item = build(2);
    expect(() => item.changeQuantity(0, NOW)).toThrow(InvalidCartQuantityError);
  });
});
