import type { UserId } from '../../../identity/index.js';
import type { CartId } from '../value-objects/cart-id.value-object.js';

export interface CartProps {
  readonly id: CartId;
  readonly userId: UserId;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/**
 * A customer's cart (S3-1, SDD 5 module 6). One per customer — S3-1 has no
 * guest-cart or multi-cart concept to justify anything richer; `Cart.open`
 * is only ever reached through the repository's atomic `upsertForUser`, so
 * two concurrent first-adds cannot create two rows for the same customer.
 */
export class Cart {
  private constructor(private readonly props: CartProps) {}

  static open(props: { id: CartId; userId: UserId; now: Date }): Cart {
    return new Cart({
      id: props.id,
      userId: props.userId,
      createdAt: props.now,
      updatedAt: props.now,
    });
  }

  static reconstitute(props: CartProps): Cart {
    return new Cart(props);
  }

  get id(): CartId {
    return this.props.id;
  }

  get userId(): UserId {
    return this.props.userId;
  }

  get createdAt(): Date {
    return this.props.createdAt;
  }

  get updatedAt(): Date {
    return this.props.updatedAt;
  }
}
