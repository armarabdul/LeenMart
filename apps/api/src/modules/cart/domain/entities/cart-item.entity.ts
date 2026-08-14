import type { ProductVariantId } from '../../../catalogue/index.js';
import { InvalidCartQuantityError } from '../errors/cart-errors.js';
import type { CartId } from '../value-objects/cart-id.value-object.js';
import type { CartItemId } from '../value-objects/cart-item-id.value-object.js';

export interface CartItemProps {
  readonly id: CartItemId;
  readonly cartId: CartId;
  readonly variantId: ProductVariantId;
  readonly quantity: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/**
 * One line in a cart (S3-1). `variantId` is catalogue's own published
 * `ProductVariantId` brand — imported through `catalogue/index.ts`, the same
 * way `Address.userId` imports identity's `UserId` — but is stored as a
 * plain `uuid` column with no database foreign key (SDD 5.1: no FK crossing
 * a module boundary except to `users`/`vendors`). Existence and eligibility
 * are checked at the application layer, not by this entity: `CartItem` only
 * knows its own bare invariant (a positive integer quantity), never the
 * variant's `quantityStep` or `Inventory.available` — both belong to
 * `catalogue` and are checked by the use case, which is the layer that
 * actually has them in hand.
 */
export class CartItem {
  private constructor(private readonly props: CartItemProps) {}

  static add(props: {
    id: CartItemId;
    cartId: CartId;
    variantId: ProductVariantId;
    quantity: number;
    now: Date;
  }): CartItem {
    assertPositiveInteger(props.quantity);
    return new CartItem({
      id: props.id,
      cartId: props.cartId,
      variantId: props.variantId,
      quantity: props.quantity,
      createdAt: props.now,
      updatedAt: props.now,
    });
  }

  static reconstitute(props: CartItemProps): CartItem {
    return new CartItem(props);
  }

  get id(): CartItemId {
    return this.props.id;
  }

  get cartId(): CartId {
    return this.props.cartId;
  }

  get variantId(): ProductVariantId {
    return this.props.variantId;
  }

  get quantity(): number {
    return this.props.quantity;
  }

  get createdAt(): Date {
    return this.props.createdAt;
  }

  get updatedAt(): Date {
    return this.props.updatedAt;
  }

  changeQuantity(quantity: number, now: Date): CartItem {
    assertPositiveInteger(quantity);
    return new CartItem({ ...this.props, quantity, updatedAt: now });
  }
}

const assertPositiveInteger = (quantity: number): void => {
  if (!Number.isInteger(quantity) || quantity <= 0) {
    throw new InvalidCartQuantityError('Must be a positive whole number.');
  }
};
