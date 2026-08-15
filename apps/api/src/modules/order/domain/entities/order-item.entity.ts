import type { Money } from '@leen-mart/domain-kit';
import type { ProductId, ProductVariantId } from '../../../catalogue/index.js';
import type { VendorId } from '../../../identity/index.js';
import type { OrderItemId } from '../value-objects/order-item-id.value-object.js';
import type { SubOrderId } from '../value-objects/sub-order-id.value-object.js';

/**
 * Tax as resolved-or-not, never defaulted to zero (S3-3A, decision D-S3-02).
 * `resolved: false` means every other field is `null` — an unresolved
 * amount and a zero-rated one are different facts, and this shape refuses
 * to collapse them into one representation, mirroring the database's own
 * `chk_order_items_tax_resolution_shape` equivalence constraint.
 */
export type TaxSnapshot =
  | { readonly resolved: true; readonly rateBasisPoints: number; readonly amount: Money }
  | { readonly resolved: false; readonly rateBasisPoints: null; readonly amount: null };

export interface OrderItemProps {
  readonly id: OrderItemId;
  readonly subOrderId: SubOrderId;
  readonly productId: ProductId;
  readonly variantId: ProductVariantId;
  readonly vendorId: VendorId;
  readonly productNameSnapshot: string;
  readonly variantNameSnapshot: string;
  readonly vendorShopNameSnapshot: string;
  readonly unitOfMeasureSnapshot: string;
  readonly quantity: number;
  readonly unitPrice: Money;
  readonly lineAmount: Money;
  readonly hsnCodeSnapshot: string | null;
  readonly tax: TaxSnapshot;
  readonly commissionRateBasisPoints: number;
  readonly commissionAmount: Money;
  readonly createdAt: Date;
}

/**
 * One line in a `SubOrder` (S3-3A, SDD 6.3) — the immutable checkout
 * snapshot. Every `*Snapshot` field, `unitPrice`, `lineAmount`, `tax` and
 * the commission fields are fixed at placement and never change afterward:
 * this entity has no mutator method at all, unlike `Order`/`SubOrder`,
 * because nothing about a placed line item is meant to change — a vendor
 * editing their price or a product's name later must not alter historic
 * orders (SDD 6.3's own stated reasoning for why this snapshot exists).
 */
export class OrderItem {
  private constructor(private readonly props: OrderItemProps) {}

  static create(props: OrderItemProps): OrderItem {
    return new OrderItem(props);
  }

  static reconstitute(props: OrderItemProps): OrderItem {
    return new OrderItem(props);
  }

  get id(): OrderItemId {
    return this.props.id;
  }

  get subOrderId(): SubOrderId {
    return this.props.subOrderId;
  }

  get productId(): ProductId {
    return this.props.productId;
  }

  get variantId(): ProductVariantId {
    return this.props.variantId;
  }

  get vendorId(): VendorId {
    return this.props.vendorId;
  }

  get productNameSnapshot(): string {
    return this.props.productNameSnapshot;
  }

  get variantNameSnapshot(): string {
    return this.props.variantNameSnapshot;
  }

  get vendorShopNameSnapshot(): string {
    return this.props.vendorShopNameSnapshot;
  }

  get unitOfMeasureSnapshot(): string {
    return this.props.unitOfMeasureSnapshot;
  }

  get quantity(): number {
    return this.props.quantity;
  }

  get unitPrice(): Money {
    return this.props.unitPrice;
  }

  get lineAmount(): Money {
    return this.props.lineAmount;
  }

  get hsnCodeSnapshot(): string | null {
    return this.props.hsnCodeSnapshot;
  }

  get tax(): TaxSnapshot {
    return this.props.tax;
  }

  get commissionRateBasisPoints(): number {
    return this.props.commissionRateBasisPoints;
  }

  get commissionAmount(): Money {
    return this.props.commissionAmount;
  }

  get createdAt(): Date {
    return this.props.createdAt;
  }
}
