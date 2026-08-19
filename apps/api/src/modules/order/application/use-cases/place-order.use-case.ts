import {
  Money,
  toUuid,
  type Clock,
  type TransactionScope,
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
import type { VendorProfile, VendorRepository, VendorShopAddress } from '../../../vendor/index.js';
import type { OutboxWriter } from '../../../../shared/application/ports/outbox-writer.port.js';
import { Order, type OrderAddressSnapshot } from '../../domain/entities/order.entity.js';
import { OrderItem, type TaxSnapshot } from '../../domain/entities/order-item.entity.js';
import { SubOrder, type PickupLocationSnapshot } from '../../domain/entities/sub-order.entity.js';
import { FulfilmentMode } from '../../domain/value-objects/fulfilment-mode.value-object.js';
import { ORDER_AUDIT_ACTIONS, ORDER_AUDIT_ENTITY_TYPES } from '../../domain/audit-actions.js';
import {
  AddressNotServiceableError,
  EmptyCartError,
  InsufficientStockError,
  OrderAddressNotFoundError,
  OrderSlotUnavailableError,
  PickupNotSupportedByVendorError,
  ProductNotEligibleForOrderError,
  VendorClosedForDeliveryError,
  VendorNotEligibleForOrderError,
} from '../../domain/errors/order-errors.js';
import type { OrderRepository } from '../../domain/repositories/order.repository.js';
import type { SlotAvailabilityRepository } from '../../../vendor/domain/repositories/delivery-slot.repository.js';
import type { SlotSelection } from '../../../vendor/domain/services/delivery-slot-policy.js';
import type { ResolveServiceabilityUseCase } from './resolve-serviceability.use-case.js';
import type { ResolveBusinessHoursUseCase } from './resolve-business-hours.use-case.js';
import type {
  ResolveSlotSelectionUseCase,
  ResolvedSlot,
} from './resolve-slot-selection.use-case.js';
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
  /**
   * S4-SLOTS: the fulfilment window the customer chose from each vendor that
   * offers them, as `[vendorId, { date, startMinute }]` pairs. Applies to
   * `PICKUP` exactly as to `DELIVERY` (locked decision S4).
   *
   * Only the date and the start minute are accepted; the window's end and its
   * capacity are read from the vendor's own template, so a client cannot widen
   * a window or inflate its capacity. A vendor that offers windows and is
   * named here with none fails the whole placement rather than being assigned
   * one (`OrderSlotRequiredError`).
   */
  readonly slotSelections?: readonly (readonly [VendorId, SlotSelection])[] | undefined;
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
  /**
   * S4-SERV. A use case rather than a repository here, so the "unconfigured
   * vendor serves everywhere" rule (D7) is applied in exactly one place and
   * `PlaceOrderUseCase` stays a policy caller rather than a policy owner.
   */
  readonly resolveServiceabilityUseCase: ResolveServiceabilityUseCase;
  /**
   * S4-HOURS. A use case rather than a repository, so the "unconfigured vendor
   * is open" rule (H4-A) is applied in exactly one place and this stays a
   * policy caller rather than a policy owner.
   */
  readonly resolveBusinessHoursUseCase: ResolveBusinessHoursUseCase;
  /**
   * S4-SLOTS. Resolves the customer's chosen window against the vendor's own
   * template — the end minute and the capacity come from the template, never
   * from the request.
   */
  readonly resolveSlotSelectionUseCase: ResolveSlotSelectionUseCase;
  /** S4-SLOTS. The capacity counter itself, re-bound to the placement transaction. */
  readonly slotAvailabilityRepository: SlotAvailabilityRepository;
  readonly resolveCommissionUseCase: ResolveCommissionUseCase;
  readonly resolveTaxUseCase: ResolveTaxUseCase;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
  readonly logger: Logger;
}

/**
 * Everything the placement transaction needs, in one value.
 *
 * A single parameter rather than five: the members always travel together, and
 * the collection matches what `PlaceOrderUseCase.execute` has already resolved
 * by the time the transaction opens.
 */
interface PlacementPlan {
  readonly principal: Principal;
  readonly address: Address;
  readonly pricedLines: readonly PricedLine[];
  readonly pickupVendorIds: ReadonlySet<VendorId>;
  readonly slots: ReadonlyMap<VendorId, ResolvedSlot>;
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
  /**
   * S4-ADDR. Travels on the line for the same reason `vendorShopName` does:
   * it is read from the vendor exactly once, here, and everything downstream
   * uses the captured copy. `null` when the vendor has set no shop address —
   * which is legal, and simply means a pickup sub-order carries no location.
   */
  readonly vendorShopAddress: VendorShopAddress | null;
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
    // SDD 4.2 step 4b, in its own position: serviceability is validated after
    // the vendors are known and *before* any pricing, tax or commission work
    // (steps 4d/4e) — there is no reason to compute money for an order that
    // cannot be delivered.
    await this.assertServiceable(address, vendors, pickupVendorIds);
    // SDD 4.2 step 4c, the second half of what that step validates: hours are
    // checked alongside serviceability and still ahead of steps 4d/4e, so a
    // closed vendor costs no tax or commission work either.
    await this.assertOpenForDelivery(vendors, pickupVendorIds);
    // SDD 4.2 step 4c, the first half of what that step validates (FR-27):
    // the chosen window is checked here, still ahead of steps 4d/4e, so an
    // unrecognised slot costs no tax or commission work either. Capacity is
    // *not* checked here — see `resolveSlotSelectionUseCase`'s own comment.
    const slots = await this.deps.resolveSlotSelectionUseCase.execute({
      vendorIds: [...vendors.keys()],
      selections: new Map(input.slotSelections ?? []),
    });
    const pricedLines = await this.priceLines(resolvedLines, vendors);

    const order = await this.placeInTransaction({
      principal,
      address,
      pricedLines,
      pickupVendorIds,
      slots,
    });

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

  /**
   * SDD 4.2 step 4b — "Validate serviceability for each vendor" (ASM-17),
   * S4-SERV.
   *
   * Evaluated **per vendor**, and only for the vendors whose sub-order will be
   * `DELIVERY`: a `PICKUP` sub-order is collected at the shop, so the
   * customer's delivery pincode says nothing about it (locked decision D6).
   * Pickup vendors are filtered out before the lookup rather than resolved and
   * then ignored, so a pickup-only order performs no serviceability query at
   * all.
   *
   * The pincode comes from `address`, which `loadAddress` has already resolved
   * by id **scoped to the caller** — never from the request body. A customer
   * cannot state a pincode; they can only choose among addresses they own.
   *
   * All-or-nothing (locked decision D4): one unserviceable delivery vendor
   * refuses the entire placement. Nothing is partially placed, and no
   * sub-order is silently flipped between `DELIVERY` and `PICKUP` to make the
   * order fit.
   */
  private async assertServiceable(
    address: Address,
    vendors: ReadonlyMap<VendorId, VendorProfile>,
    pickupVendorIds: ReadonlySet<VendorId>,
  ): Promise<void> {
    const deliveryVendorIds = [...vendors.keys()].filter(
      (vendorId) => !pickupVendorIds.has(vendorId),
    );

    const unserviceable = await this.deps.resolveServiceabilityUseCase.execute({
      pincode: address.pincode,
      deliveryVendorIds,
    });

    if (unserviceable.length > 0) {
      this.deps.logger.info(
        { pincode: address.pincode, unserviceableVendorCount: unserviceable.length },
        'Order refused: one or more delivery vendors do not serve this pincode',
      );
      throw new AddressNotServiceableError();
    }
  }

  /**
   * SDD 4.2 step 4c — "Validate slot capacity + business hours" (FR-27),
   * S4-HOURS. Slot capacity is S4-SLOTS and deliberately absent; this is the
   * business-hours half.
   *
   * Evaluated **per vendor**, and only for the vendors whose sub-order will be
   * `DELIVERY`: business hours govern delivery only, and a `PICKUP` sub-order
   * is exempt outright (locked decision H2-A). Pickup vendors are filtered out
   * before the lookup, so a pickup-only order performs no query at all.
   *
   * All-or-nothing (locked decision H1-A): one closed delivery vendor refuses
   * the entire placement. Nothing is partially placed, nothing is deferred to
   * a later window, and no sub-order is silently flipped to `PICKUP` to make
   * the order fit.
   */
  private async assertOpenForDelivery(
    vendors: ReadonlyMap<VendorId, VendorProfile>,
    pickupVendorIds: ReadonlySet<VendorId>,
  ): Promise<void> {
    const deliveryVendorIds = [...vendors.keys()].filter(
      (vendorId) => !pickupVendorIds.has(vendorId),
    );

    const closed = await this.deps.resolveBusinessHoursUseCase.execute({ deliveryVendorIds });

    if (closed.length > 0) {
      this.deps.logger.info(
        { closedVendorCount: closed.length },
        'Order refused: one or more delivery vendors are closed right now',
      );
      throw new VendorClosedForDeliveryError();
    }
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
        vendorShopAddress: vendor.shopAddress,
        commissionRateBasisPoints: commission.rule.rateBasisPoints,
        commissionAmount: commission.commissionAmount,
        tax,
      });
    }
    return priced;
  }

  /**
   * Steps 10–14: the one atomic transaction — inventory decrement, slot
   * capacity consumption, aggregate insert, outbox insert.
   *
   * S4-SLOTS: capacity is taken here rather than earlier because this is the
   * only point at which "taken" and "the order exists" become the same fact.
   * A failure at any step rolls back every other, so an order is never placed
   * against a window it did not get, and a window is never consumed by an
   * order that did not commit (locked decisions S5/S7 — no reservation exists
   * to expire, because nothing is held before the order is real).
   */
  private async placeInTransaction(plan: PlacementPlan): Promise<Order> {
    const { principal, address, pricedLines, slots } = plan;
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

    return transactionRunner.run(async (scope) => {
      const inventory = inventoryRepository.withTransaction(scope);
      for (const line of pricedLines) {
        const decremented = await inventory.decrementIfAvailable(line.variantId, line.quantity);
        if (!decremented) {
          throw new InsufficientStockError();
        }
      }

      await this.consumeSlots(scope, slots);

      const subOrders = this.buildSubOrders(orderId, plan, now);
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
   * One `SubOrder` per vendor in the cart, each carrying the snapshots that
   * make it immutable evidence: shop name, pickup location (S4-ADDR) and
   * fulfilment window (S4-SLOTS).
   */
  private buildSubOrders(
    orderId: ReturnType<typeof toOrderId>,
    plan: PlacementPlan,
    now: Date,
  ): readonly SubOrder[] {
    const { pricedLines, pickupVendorIds, slots } = plan;
    return [...groupByVendor(pricedLines).entries()].map(([vendorId, vendorLines]) => {
      const isPickup = pickupVendorIds.has(vendorId);
      const fulfilmentMode = isPickup ? FulfilmentMode.PICKUP : FulfilmentMode.DELIVERY;
      // S4-ADDR: the collection address is captured here, once, and only for
      // PICKUP. A DELIVERY sub-order gets `null` — it has no collection point
      // — and nothing ever re-reads this from the vendor profile afterwards,
      // which is what makes a later shop relocation unable to rewrite where an
      // existing order said to collect.
      const pickupLocationSnapshot = isPickup ? (vendorLines[0]?.vendorShopAddress ?? null) : null;
      return this.buildSubOrder(orderId, vendorId, vendorLines, {
        now,
        fulfilmentMode,
        pickupLocationSnapshot,
        // S4-SLOTS: the same snapshot reasoning, applied to time. `null` for a
        // vendor who offers no windows, and never re-read from the vendor's
        // templates afterwards.
        slot: slots.get(vendorId) ?? null,
      });
    });
  }

  /**
   * Takes one unit of capacity per booked sub-order (locked decision S2 — one
   * sub-order, one unit, never items or weight), inside the placement's own
   * transaction.
   *
   * **Deterministically ordered.** Two concurrent multi-vendor orders touching
   * the same two windows would otherwise be free to lock them in opposite
   * orders and deadlock; sorting by the row's own primary key means every
   * placement in the system acquires these rows in the same sequence.
   *
   * Each vendor is consumed independently and a single failure aborts the
   * whole order — the all-or-nothing rule every other placement precondition
   * already follows. No other window is tried.
   */
  private async consumeSlots(
    scope: TransactionScope,
    slots: ReadonlyMap<VendorId, ResolvedSlot>,
  ): Promise<void> {
    if (slots.size === 0) return;

    const repository = this.deps.slotAvailabilityRepository.withTransaction(scope);
    const ordered = [...slots.entries()].sort(
      ([vendorA, slotA], [vendorB, slotB]) =>
        vendorA.localeCompare(vendorB) ||
        slotA.date.localeCompare(slotB.date) ||
        slotA.startMinute - slotB.startMinute,
    );

    for (const [vendorId, slot] of ordered) {
      const consumed = await repository.consume(vendorId, slot);
      if (!consumed) {
        this.deps.logger.info(
          { vendorId, slotDate: slot.date, slotStartMinute: slot.startMinute },
          'Order refused: the chosen slot filled before placement',
        );
        throw new OrderSlotUnavailableError();
      }
    }
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
    context: {
      readonly now: Date;
      readonly fulfilmentMode: FulfilmentMode;
      readonly pickupLocationSnapshot: PickupLocationSnapshot | null;
      readonly slot: ResolvedSlot | null;
    },
  ): SubOrder {
    const { now, fulfilmentMode, pickupLocationSnapshot, slot } = context;
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
      pickupLocationSnapshot,
      slot:
        slot === null
          ? null
          : { date: slot.date, startMinute: slot.startMinute, endMinute: slot.endMinute },
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
