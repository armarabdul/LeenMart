import {
  Money,
  toUuid,
  type Clock,
  type IdGenerator,
  type Logger,
  type TransactionRunner,
} from '@leen-mart/domain-kit';
import type {
  InventoryRepository,
  ProductId,
  ProductRepository,
  ProductVariantId,
  ProductVariantRepository,
} from '../../../catalogue/index.js';
import type { CartItem, CartItemRepository, CartRepository } from '../../../cart/index.js';
import { type Address, type AddressId, type AddressRepository } from '../../../customer/index.js';
import type { Principal, VendorId } from '../../../identity/index.js';
import type { ResolveCommissionUseCase, ResolveTaxUseCase } from '../../../pricing-tax/index.js';
import type { VendorProfile, VendorRepository } from '../../../vendor/index.js';
import type { OutboxWriter } from '../../../../shared/application/ports/outbox-writer.port.js';
import { Order, type OrderAddressSnapshot } from '../../domain/entities/order.entity.js';
import { OrderItem, type TaxSnapshot } from '../../domain/entities/order-item.entity.js';
import { SubOrder } from '../../domain/entities/sub-order.entity.js';
import { FulfilmentMode } from '../../domain/value-objects/fulfilment-mode.value-object.js';
import { ORDER_AUDIT_ACTIONS, ORDER_AUDIT_ENTITY_TYPES } from '../../domain/audit-actions.js';
import {
  EmptyCartError,
  InsufficientStockError,
  OrderAddressNotFoundError,
  PickupNotSupportedByVendorError,
  ProductNotEligibleForOrderError,
  VendorNotEligibleForOrderError,
} from '../../domain/errors/order-errors.js';
import type { OrderRepository } from '../../domain/repositories/order.repository.js';
import { toOrderId } from '../../domain/value-objects/order-id.value-object.js';
import { toOrderItemId } from '../../domain/value-objects/order-item-id.value-object.js';
import { toSubOrderId } from '../../domain/value-objects/sub-order-id.value-object.js';

export interface PlaceOrderInput {
  readonly principal: Principal;
  readonly addressId: AddressId;
  /** The contract narrows this to the literal `'ONLINE'` — see the class doc comment for why nothing else is accepted. */
  readonly paymentMethod: 'ONLINE';
  /**
   * S4-QR: the vendors, among those actually present in the cart, the
   * customer wants `PICKUP` from — every other vendor defaults to
   * `DELIVERY`. A vendor listed here whose `VendorProfile.supportsPickup` is
   * `false` fails the whole placement with `PickupNotSupportedByVendorError`
   * rather than being silently downgraded (locked decision).
   */
  readonly pickupVendorIds?: readonly VendorId[] | undefined;
}

export interface PlaceOrderDeps {
  /** Bound to the plain, non-RLS client — `carts`/`cart_items` carry no RLS, ownership is enforced by `userId` (S3-1 precedent). */
  readonly cartRepository: CartRepository;
  readonly cartItemRepository: CartItemRepository;
  /** Bound to the plain, non-RLS client — `addresses` carries no RLS either. */
  readonly addressRepository: AddressRepository;
  /**
   * Bound to `publicPrisma` — the exact precedent `AddCartItemUseCase`
   * already establishes: a `findById` returning non-null under the public
   * role's RLS *is* the eligibility proof (`APPROVED`, non-deleted).
   */
  readonly productRepository: ProductRepository;
  readonly productVariantRepository: ProductVariantRepository;
  /** Bound to `leenmart_checkout` — the only credential that can read every vendor in a multi-vendor cart (see the migration's own comment). */
  readonly vendorRepository: VendorRepository;
  /** Bound to `leenmart_checkout` — the only credential with the atomic-decrement grant. */
  readonly inventoryRepository: InventoryRepository;
  readonly orderRepository: OrderRepository;
  readonly outboxWriter: OutboxWriter;
  /** `CheckoutTransactionRunner` — a plain transaction on the checkout credential, no tenant GUCs. */
  readonly transactionRunner: TransactionRunner;
  readonly resolveCommissionUseCase: ResolveCommissionUseCase;
  readonly resolveTaxUseCase: ResolveTaxUseCase;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
  readonly logger: Logger;
}

/** One cart line, resolved against fresh catalogue data (SEC-02) before any transaction opens. */
interface ResolvedLine {
  readonly cartItem: CartItem;
  readonly productId: ProductId;
  readonly productName: string;
  readonly hsnCode: string | null;
  readonly variantId: ProductVariantId;
  readonly variantName: string;
  readonly unitOfMeasure: string;
  readonly unitPrice: Money;
  readonly vendorId: VendorId;
  readonly quantity: number;
  readonly lineAmount: Money;
}

/** A resolved line plus its per-line economics (commission always resolved, tax resolved-or-not). */
interface PricedLine extends ResolvedLine {
  /** Captured once here, where `resolveVendors()`'s non-null check is still in scope — never re-narrowed downstream. */
  readonly vendorShopName: string;
  readonly commissionRateBasisPoints: number;
  readonly commissionAmount: Money;
  readonly tax: TaxSnapshot;
}

const toAddressSnapshot = (address: Address): OrderAddressSnapshot => ({
  recipientName: address.recipientName,
  phone: address.phone,
  line1: address.line1,
  line2: address.line2,
  city: address.city,
  state: address.state,
  pincode: address.pincode,
  landmark: address.landmark,
  label: address.label,
});

const groupByVendor = (lines: readonly PricedLine[]): Map<VendorId, PricedLine[]> => {
  const groups = new Map<VendorId, PricedLine[]>();
  for (const line of lines) {
    const existing = groups.get(line.vendorId);
    if (existing) {
      existing.push(line);
    } else {
      groups.set(line.vendorId, [line]);
    }
  }
  return groups;
};

const sumMoney = (amounts: readonly Money[]): Money =>
  amounts.reduce((total, amount) => total.add(amount), Money.zero());

/**
 * Places an order from the caller's cart (S3-3A, SDD 4.2's `PlaceOrderUseCase`
 * flow, traced against the approved decisions).
 *
 * **Only `paymentMethod: 'ONLINE'` is accepted** — COD is blocked (approved
 * decision: "verified customer address" is undefined and trust-score
 * infrastructure is Stage 6, so COD eligibility cannot be evaluated
 * honestly). The contract's own schema already narrows the wire value to
 * this literal; this type does too, so a caller cannot construct an input
 * this use case would have to reject at runtime.
 *
 * **Order reaches `PENDING_PAYMENT` and stops there.** No transition to
 * `CONFIRMED` happens here — S3-3A's approved payment scope is "the minimum
 * abstraction necessary for the order flow to reach a payment-pending
 * state," and confirming payment (real or mock) is S3-3B's own milestone.
 *
 * **Steps, matching SDD 4.2's own ordering exactly:**
 *  1–2. Load and validate the cart (outside any transaction).
 *  3. Re-resolve every price fresh from the database (SEC-02) — never trust
 *     the cart's own rows, which carry no price snapshot by design (S3-1).
 *  4–5. Resolve tax and commission per line (pure reads, no side effects).
 *  6. Validate the address belongs to the caller.
 *  9. Group by vendor.
 *  10–14. BEGIN TX: atomic inventory decrement per line, insert
 *     Order+SubOrder[]+OrderItem[], insert the `OrderPlaced` outbox event.
 *     COMMIT.
 *  (No step 16/17 — no payment gateway call of any kind, real or mock,
 *  happens here or anywhere in S3-3A.)
 *
 * The cart is cleared **after** the transaction commits, not inside it —
 * `leenmart_checkout` was deliberately not granted access to
 * `carts`/`cart_items` (kept to exactly the tables S3-3A's own scope
 * enumerates), so this is a best-effort step on the existing customer-owned
 * cart repositories. A failure here leaves stale cart rows, a recoverable
 * UX inconvenience — never a duplicate order or a double inventory
 * decrement, since a second checkout attempt is a genuinely new,
 * independently-validated transaction.
 *
 * No `AuditWriter` call, matching the `Cart`/`Address` precedent exactly:
 * SDD 18.4's audit-log list is admin-action-focused (approvals, holds,
 * refunds, KYC access, role changes) and never names an ordinary customer
 * self-service action. Placing an order is that — not an admin action —
 * so this follows the same "no audit trail" convention Cart/Address already
 * established, rather than inventing a new one.
 */
export class PlaceOrderUseCase {
  constructor(private readonly deps: PlaceOrderDeps) {}

  async execute(input: PlaceOrderInput): Promise<Order> {
    const { principal, addressId } = input;
    const pickupVendorIds = new Set(input.pickupVendorIds ?? []);

    const cartItems = await this.loadCartItems(principal.userId);
    const address = await this.loadAddress(addressId, principal.userId);
    const resolvedLines = await this.resolveLines(cartItems);
    const vendors = await this.resolveVendors(resolvedLines, pickupVendorIds);
    const pricedLines = await this.priceLines(resolvedLines, vendors);

    const order = await this.placeInTransaction(principal, address, pricedLines, pickupVendorIds);

    await this.clearCartBestEffort(principal.userId);

    this.deps.logger.info(
      { orderId: order.id, subOrderCount: order.subOrders.length },
      'Order placed',
    );
    return order;
  }

  private async loadCartItems(userId: Principal['userId']): Promise<readonly CartItem[]> {
    const cart = await this.deps.cartRepository.findByUserId(userId);
    if (!cart) {
      throw new EmptyCartError();
    }
    const items = await this.deps.cartItemRepository.listByCartId(cart.id);
    if (items.length === 0) {
      throw new EmptyCartError();
    }
    return items;
  }

  private async loadAddress(addressId: AddressId, userId: Principal['userId']): Promise<Address> {
    const address = await this.deps.addressRepository.findById(addressId, userId);
    if (!address) {
      throw new OrderAddressNotFoundError();
    }
    return address;
  }

  /** Step 3: fresh product/variant resolution, the same eligibility proof `AddCartItemUseCase` already relies on. */
  private async resolveLines(cartItems: readonly CartItem[]): Promise<readonly ResolvedLine[]> {
    const lines: ResolvedLine[] = [];
    for (const cartItem of cartItems) {
      const variant = await this.deps.productVariantRepository.findById(cartItem.variantId);
      if (!variant) {
        throw new ProductNotEligibleForOrderError();
      }
      const product = await this.deps.productRepository.findById(variant.productId);
      if (!product) {
        throw new ProductNotEligibleForOrderError();
      }
      lines.push({
        cartItem,
        productId: product.id,
        productName: product.name,
        hsnCode: product.hsnCode,
        variantId: variant.id,
        variantName: variant.name,
        unitOfMeasure: variant.unitOfMeasure,
        unitPrice: variant.price,
        vendorId: variant.vendorId,
        quantity: cartItem.quantity,
        lineAmount: variant.price.multiply(cartItem.quantity),
      });
    }
    return lines;
  }

  /**
   * Every vendor appearing in the cart must be `ACTIVE` and have set a
   * `shopName` (decisions D-S3-03/D-S3-04). S4-QR: a vendor also named in
   * `pickupVendorIds` must additionally have `supportsPickup === true` —
   * never silently downgraded to `DELIVERY` (locked decision #25).
   */
  private async resolveVendors(
    lines: readonly ResolvedLine[],
    pickupVendorIds: ReadonlySet<VendorId>,
  ): Promise<ReadonlyMap<VendorId, VendorProfile>> {
    const vendorIds = [...new Set(lines.map((line) => line.vendorId))];
    const vendors = new Map<VendorId, VendorProfile>();
    for (const vendorId of vendorIds) {
      const vendor = await this.deps.vendorRepository.findById(vendorId);
      if (!vendor || vendor.status.name !== 'ACTIVE' || !vendor.shopName) {
        throw new VendorNotEligibleForOrderError();
      }
      if (pickupVendorIds.has(vendorId) && !vendor.supportsPickup) {
        throw new PickupNotSupportedByVendorError();
      }
      vendors.set(vendorId, vendor);
    }
    return vendors;
  }

  /** Steps 4–5: tax and commission, per line, honestly (decision D-S3-02: never invent, never default to ₹0). */
  private async priceLines(
    lines: readonly ResolvedLine[],
    vendors: ReadonlyMap<VendorId, VendorProfile>,
  ): Promise<readonly PricedLine[]> {
    const now = this.deps.clock.now();
    const priced: PricedLine[] = [];
    for (const line of lines) {
      const vendor = vendors.get(line.vendorId);
      // resolveVendors() already refused any vendorId without an ACTIVE,
      // shopName-carrying entry — this narrows both facts back into scope
      // rather than re-asserting them with a cast.
      if (!vendor?.shopName) {
        throw new VendorNotEligibleForOrderError();
      }
      const commission = await this.deps.resolveCommissionUseCase.execute({
        plan: vendor.plan,
        amount: line.lineAmount,
        asOf: now,
      });
      const taxResolution = await this.deps.resolveTaxUseCase.execute({
        hsnCode: line.hsnCode,
        amount: line.lineAmount,
        asOf: now,
      });
      const tax: TaxSnapshot = taxResolution.resolved
        ? {
            resolved: true,
            rateBasisPoints: taxResolution.rate.rateBasisPoints,
            amount: taxResolution.taxAmount,
          }
        : { resolved: false, rateBasisPoints: null, amount: null };

      priced.push({
        ...line,
        vendorShopName: vendor.shopName,
        commissionRateBasisPoints: commission.rule.rateBasisPoints,
        commissionAmount: commission.commissionAmount,
        tax,
      });
    }
    return priced;
  }

  /** Steps 10–14: the one atomic transaction — inventory decrement, aggregate insert, outbox insert. */
  private async placeInTransaction(
    principal: Principal,
    address: Address,
    pricedLines: readonly PricedLine[],
    pickupVendorIds: ReadonlySet<VendorId>,
  ): Promise<Order> {
    const {
      transactionRunner,
      inventoryRepository,
      orderRepository,
      outboxWriter,
      idGenerator,
      clock,
    } = this.deps;
    const now = clock.now();
    const orderId = toOrderId(idGenerator.generate());
    const linesByVendor = groupByVendor(pricedLines);

    return transactionRunner.run(async (scope) => {
      const inventory = inventoryRepository.withTransaction(scope);
      for (const line of pricedLines) {
        const decremented = await inventory.decrementIfAvailable(line.variantId, line.quantity);
        if (!decremented) {
          throw new InsufficientStockError();
        }
      }

      const subOrders = [...linesByVendor.entries()].map(([vendorId, vendorLines]) => {
        const fulfilmentMode = pickupVendorIds.has(vendorId)
          ? FulfilmentMode.PICKUP
          : FulfilmentMode.DELIVERY;
        return this.buildSubOrder(orderId, vendorId, vendorLines, { now, fulfilmentMode });
      });
      const order = Order.place({
        id: orderId,
        customerId: principal.userId,
        totalAmount: sumMoney(subOrders.map((subOrder) => subOrder.totalAmount)),
        address: toAddressSnapshot(address),
        subOrders,
        now,
      });

      await orderRepository.withTransaction(scope).create(order);
      await outboxWriter.withTransaction(scope).write({
        aggregateType: ORDER_AUDIT_ENTITY_TYPES.ORDER,
        aggregateId: toUuid(order.id),
        eventType: ORDER_AUDIT_ACTIONS.PLACED,
        payload: {
          orderId: order.id,
          customerId: principal.userId,
          subOrderCount: subOrders.length,
        },
      });

      return order;
    });
  }

  /**
   * `now`/`fulfilmentMode` travel as one object rather than as two more
   * positional arguments — S4-QR's addition of the mode pushed this past the
   * four-parameter budget, and the two are always decided together by the
   * caller anyway.
   */
  private buildSubOrder(
    orderId: ReturnType<typeof toOrderId>,
    vendorId: VendorId,
    lines: readonly PricedLine[],
    context: { readonly now: Date; readonly fulfilmentMode: FulfilmentMode },
  ): SubOrder {
    const { now, fulfilmentMode } = context;
    const { idGenerator } = this.deps;
    // `groupByVendor` never produces an empty group — every entry in its
    // map came from pushing at least one line onto it — but `lines[0]` is
    // still `PricedLine | undefined` under `noUncheckedIndexedAccess`. This
    // narrows it rather than asserting past it.
    const vendorShopName = lines[0]?.vendorShopName;
    if (!vendorShopName) {
      throw new VendorNotEligibleForOrderError();
    }

    const subOrderId = toSubOrderId(idGenerator.generate());
    const items = lines.map((line) =>
      OrderItem.create({
        id: toOrderItemId(idGenerator.generate()),
        subOrderId,
        productId: line.productId,
        variantId: line.variantId,
        vendorId,
        productNameSnapshot: line.productName,
        variantNameSnapshot: line.variantName,
        vendorShopNameSnapshot: line.vendorShopName,
        unitOfMeasureSnapshot: line.unitOfMeasure,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        lineAmount: line.lineAmount,
        hsnCodeSnapshot: line.hsnCode,
        tax: line.tax,
        commissionRateBasisPoints: line.commissionRateBasisPoints,
        commissionAmount: line.commissionAmount,
        createdAt: now,
      }),
    );

    return SubOrder.open({
      id: subOrderId,
      orderId,
      vendorId,
      fulfilmentMode,
      vendorShopNameSnapshot: vendorShopName,
      totalAmount: sumMoney(items.map((item) => item.lineAmount)),
      items,
      now,
    });
  }

  private async clearCartBestEffort(userId: Principal['userId']): Promise<void> {
    const { cartRepository, cartItemRepository, clock, logger } = this.deps;
    try {
      const cart = await cartRepository.findByUserId(userId);
      if (cart) {
        await cartItemRepository.softDeleteAllForCart(cart.id, clock.now());
      }
    } catch (error) {
      // Never fails order placement — the order already committed. A stale
      // cart is a recoverable inconvenience, not a correctness problem (see
      // the class doc comment).
      logger.warn({ err: error, userId }, 'Failed to clear cart after order placement');
    }
  }
}
