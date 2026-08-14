import { describe, expect, it } from 'vitest';
import { UuidV7Generator } from '@leen-mart/domain-kit';
import { Cart } from '../../../../../src/modules/cart/domain/entities/cart.entity.js';
import { toCartId } from '../../../../../src/modules/cart/domain/value-objects/cart-id.value-object.js';
import { toUserId } from '../../../../../src/modules/identity/domain/value-objects/user-id.value-object.js';

const ids = new UuidV7Generator();
const NOW = new Date('2026-08-14T00:00:00.000Z');

describe('Cart', () => {
  it('open() sets createdAt and updatedAt to the same instant', () => {
    const cart = Cart.open({
      id: toCartId(ids.generate()),
      userId: toUserId(ids.generate()),
      now: NOW,
    });
    expect(cart.createdAt).toEqual(NOW);
    expect(cart.updatedAt).toEqual(NOW);
  });

  it('reconstitute() rebuilds an existing cart with no validation', () => {
    const id = toCartId(ids.generate());
    const userId = toUserId(ids.generate());
    const cart = Cart.reconstitute({ id, userId, createdAt: NOW, updatedAt: NOW });
    expect(cart.id).toBe(id);
    expect(cart.userId).toBe(userId);
  });
});
