import {
  toUuid,
  type Clock,
  type IdGenerator,
  type Logger,
  type TransactionRunner,
  type TransactionScope,
} from '@leen-mart/domain-kit';
import type { Address, AddressRepository } from '../../../customer/index.js';
import type {
  Product,
  ProductRepository,
  ProductVariant,
  ProductVariantRepository,
} from '../../../catalogue/index.js';
import type { VendorProfile, VendorRepository } from '../../../vendor/index.js';
import type { ResolveCommissionUseCase, ResolveTaxUseCase } from '../../../pricing-tax/index.js';
import type { PostOrderPaymentJournalsUseCase } from '../../../ledger/index.js';
import {
  FulfilmentMode,
  Order,
  OrderItem,
  SubOrder,
  ORDER_AUDIT_ACTIONS,
  ORDER_AUDIT_ENTITY_TYPES,
  toOrderId,
  toOrderItemId,
  toSubOrderId,
  type OrderAddressSnapshot,
  type OrderRepository,
  type PickupLocationSnapshot,
  type TaxSnapshot,
} from '../../../order/index.js';
import type { OutboxWriter } from '../../../../shared/application/ports/outbox-writer.port.js';
import type { PreorderCampaign } from '../../domain/entities/preorder-campaign.entity.js';
import type { PreorderReservation } from '../../domain/entities/preorder-reservation.entity.js';
import {
  CampaignNotFoundError,
  ConversionAddressNotFoundError,
  ConversionProductNoLongerEligibleError,
  ConversionVendorNotEligibleError,
  ReservationAlreadyConvertedError,
  ReservationNotFoundError,
  ReservationNotReadyForConversionError,
} from '../../domain/errors/preorder-errors.js';
import type { CampaignRepository } from '../../domain/repositories/campaign.repository.js';
import type { ReservationRepository } from '../../domain/repositories/reservation.repository.js';
import type { ReservationId } from '../../domain/value-objects/reservation-id.value-object.js';

export interface ConvertReservationToOrderDeps {
  readonly reservationRepository: ReservationRepository;
  readonly campaignRepository: CampaignRepository;
  /** Bound to the plain, non-RLS client — same credential `PlaceOrderUseCase`'s own `addressRepository` reads on. */
  readonly addressRepository: AddressRepository;
  /** `publicPrisma`-bound — the same `AddCartItemUseCase`/`PlaceOrderUseCase` eligibility-proof precedent, re-verified at conversion time rather than trusted from however long ago the reservation was created. */
  readonly productRepository: ProductRepository;
  readonly productVariantRepository: ProductVariantRepository;
  /** `leenmart_checkout`-bound — the only credential that can read any vendor regardless of tenant, the same reason `PlaceOrderUseCase` reads vendors on it. */
  readonly vendorRepository: VendorRepository;
  /** `leenmart_checkout`-bound — orders are always written on this credential, never a tenant client. */
  readonly orderRepository: OrderRepository;
  readonly resolveCommissionUseCase: ResolveCommissionUseCase;
  readonly resolveTaxUseCase: ResolveTaxUseCase;
  /** Reused, never duplicated (the implementation brief's own instruction) — the same class `order.module.ts`'s own `ConfirmPaymentUseCase` posts through. */
  readonly postOrderPaymentJournalsUseCase: PostOrderPaymentJournalsUseCase;
  readonly outboxWriter: OutboxWriter;
  /** `CheckoutTransactionRunner` bound to `leenmart_checkout` — the same credential every table this transaction touches (`orders`, `preorder_reservations`, `ledger_journals`, `outbox_events`) is granted on. */
  readonly transactionRunner: TransactionRunner;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
  readonly logger: Logger;
}

interface ConversionInputs {
  readonly reservation: PreorderReservation;
  readonly campaign: PreorderCampaign;
  readonly address: Address;
  readonly variant: ProductVariant;
  readonly product: Product;
  readonly vendor: VendorProfile;
}

interface BuiltOrder {
  readonly order: Order;
  readonly subOrder: SubOrder;
  readonly orderItem: OrderItem;
}

/**
 * The hand-off into the existing order pipeline (the implementation brief's
 * own explicit instruction: "a preorder reservation should become a normal
 * order/suborder wherever the existing architecture expects it... the
 * existing order module remains authoritative for fulfilment after
 * conversion"). **No fulfilment logic is forked here** — this builds exactly
 * the `Order`/`SubOrder`/`OrderItem` aggregate `PlaceOrderUseCase` builds for
 * an ordinary checkout, using the same entity factories, and hands it to the
 * same `OrderRepository`. Everything downstream of this call — shipping,
 * pickup/QR, delivery, vendor dashboards — is the order module's own code,
 * untouched.
 *
 * **Constructed already `CONFIRMED`, not `PENDING_PAYMENT`.** A converting
 * reservation has already collected its advance and its balance through
 * preorder's own payment surface (`InitiateReservationPaymentUseCase`/
 * `ConfirmReservationPaymentUseCase`) — there is no second payment step for
 * the resulting order to wait through. `Order.place(...).confirm(now)` is
 * built in memory and persisted whole, mirroring exactly what
 * `PlaceOrderUseCase` followed immediately by `ConfirmPaymentUseCase` would
 * produce for an ordinary order, including both outbox events
 * (`order.placed` then `order.confirmed`) so any downstream consumer
 * subscribed to either sees the same sequence a real checkout would emit.
 *
 * **No order-module `PaymentAttempt` row is created.** That table exists to
 * track an attempt against *this* module's own mock gateway; preorder's
 * advance/balance attempts already live in its own `preorder_payment_attempts`
 * table. The ledger's `paymentAttemptId` column carries no foreign key
 * (verified against `schema.prisma`) — this passes the reservation's own id
 * as that string, a stable, traceable reference to what actually settled
 * the order, without fabricating an order-module row that never existed.
 *
 * **Price is never re-resolved.** `reservation.unitPrice` — the snapshot
 * `CreateReservationUseCase` took at reservation time — is what prices the
 * resulting `OrderItem`, satisfying SDD §14.6's price freeze by
 * construction. Product/variant *display* metadata (name, HSN code, unit of
 * measure) has no snapshot on the reservation and is read fresh here
 * instead, since nothing preserved it and the identity (same `variantId`)
 * has not changed.
 */
export class ConvertReservationToOrderUseCase {
  constructor(private readonly deps: ConvertReservationToOrderDeps) {}

  /** Ownership/status resolution for the reservation itself — split out purely to keep `resolveInputs` within this repository's complexity budget. */
  private async resolveReservation(reservationId: ReservationId): Promise<PreorderReservation> {
    const reservation = await this.deps.reservationRepository.findById(reservationId);
    if (!reservation) throw new ReservationNotFoundError();
    if (reservation.convertedOrderId !== null) throw new ReservationAlreadyConvertedError();
    if (reservation.status.name !== 'CONFIRMED' || reservation.balancePaidAt === null) {
      throw new ReservationNotReadyForConversionError();
    }
    return reservation;
  }

  /** Every other resolve-or-throw read this conversion needs, in one place — split out for the same reason `resolveReservation` was. */
  private async resolveEligibility(
    reservation: PreorderReservation,
  ): Promise<Omit<ConversionInputs, 'reservation'>> {
    const {
      campaignRepository,
      addressRepository,
      productRepository,
      productVariantRepository,
      vendorRepository,
    } = this.deps;

    const campaign = await campaignRepository.findById(reservation.campaignId);
    if (!campaign) throw new CampaignNotFoundError();

    const address = await addressRepository.findById(reservation.addressId, reservation.customerId);
    if (!address) throw new ConversionAddressNotFoundError();

    // Re-verified fresh (SEC-02), the exact `AddCartItemUseCase`/
    // `PlaceOrderUseCase` eligibility-proof precedent — a `publicPrisma`
    // read returning non-null *is* the eligibility check.
    const variant = await productVariantRepository.findById(campaign.variantId);
    if (!variant) throw new ConversionProductNoLongerEligibleError();
    const product = await productRepository.findById(variant.productId);
    if (!product) throw new ConversionProductNoLongerEligibleError();

    const vendor = await vendorRepository.findById(reservation.vendorId);
    if (!vendor || vendor.status.name !== 'ACTIVE' || !vendor.shopName) {
      throw new ConversionVendorNotEligibleError();
    }

    return { campaign, address, variant, product, vendor };
  }

  /** Every resolve-or-throw read this conversion needs, in one place — split out purely to keep `execute` within this repository's complexity budget. */
  private async resolveInputs(reservationId: ReservationId): Promise<ConversionInputs> {
    const reservation = await this.resolveReservation(reservationId);
    const rest = await this.resolveEligibility(reservation);
    return { reservation, ...rest };
  }

  private async buildOrderItem(
    inputs: ConversionInputs,
    subOrderId: ReturnType<typeof toSubOrderId>,
    shopName: string,
    now: Date,
  ): Promise<{ orderItem: OrderItem; lineAmount: typeof inputs.reservation.unitPrice }> {
    const { reservation, variant, product, vendor } = inputs;
    const { idGenerator, resolveCommissionUseCase, resolveTaxUseCase } = this.deps;

    const unitPrice = reservation.unitPrice;
    const lineAmount = unitPrice.multiply(reservation.quantity);

    const commission = await resolveCommissionUseCase.execute({
      plan: vendor.plan,
      amount: lineAmount,
      asOf: now,
    });
    const taxResolution = await resolveTaxUseCase.execute({
      hsnCode: product.hsnCode,
      amount: lineAmount,
      asOf: now,
    });
    const tax: TaxSnapshot = taxResolution.resolved
      ? {
          resolved: true,
          rateBasisPoints: taxResolution.rate.rateBasisPoints,
          amount: taxResolution.taxAmount,
        }
      : { resolved: false, rateBasisPoints: null, amount: null };

    const orderItem = OrderItem.create({
      id: toOrderItemId(idGenerator.generate()),
      subOrderId,
      productId: product.id,
      variantId: variant.id,
      vendorId: reservation.vendorId,
      productNameSnapshot: product.name,
      variantNameSnapshot: variant.name,
      vendorShopNameSnapshot: shopName,
      unitOfMeasureSnapshot: variant.unitOfMeasure,
      quantity: reservation.quantity,
      unitPrice,
      lineAmount,
      hsnCodeSnapshot: product.hsnCode,
      tax,
      commissionRateBasisPoints: commission.rule.rateBasisPoints,
      commissionAmount: commission.commissionAmount,
      createdAt: now,
    });

    return { orderItem, lineAmount };
  }

  /** The `Order`/`SubOrder`/`OrderItem` aggregate, built in memory — split out for the same reason `resolveInputs` was. */
  private async buildOrder(inputs: ConversionInputs, now: Date): Promise<BuiltOrder> {
    const { reservation, address, vendor } = inputs;
    const { idGenerator } = this.deps;

    const shopName = vendor.shopName;
    if (!shopName) throw new ConversionVendorNotEligibleError();

    const orderId = toOrderId(idGenerator.generate());
    const subOrderId = toSubOrderId(idGenerator.generate());
    const { orderItem, lineAmount } = await this.buildOrderItem(inputs, subOrderId, shopName, now);

    const fulfilmentMode =
      reservation.fulfilmentMode === 'PICKUP' ? FulfilmentMode.PICKUP : FulfilmentMode.DELIVERY;
    const pickupLocationSnapshot: PickupLocationSnapshot | null =
      reservation.fulfilmentMode === 'PICKUP' ? (vendor.shopAddress ?? null) : null;

    const subOrder = SubOrder.open({
      id: subOrderId,
      orderId,
      vendorId: reservation.vendorId,
      fulfilmentMode,
      vendorShopNameSnapshot: shopName,
      pickupLocationSnapshot,
      slot: null,
      totalAmount: lineAmount,
      items: [orderItem],
      now,
    });

    const addressSnapshot: OrderAddressSnapshot = {
      recipientName: address.recipientName,
      phone: address.phone,
      line1: address.line1,
      line2: address.line2,
      city: address.city,
      state: address.state,
      pincode: address.pincode,
      landmark: address.landmark,
      label: address.label,
    };

    const order = Order.place({
      id: orderId,
      customerId: reservation.customerId,
      totalAmount: lineAmount,
      address: addressSnapshot,
      subOrders: [subOrder],
      now,
    }).confirm(now);

    return { order, subOrder, orderItem };
  }

  /** The one transaction: order create, reservation update, ledger post, outbox writes — split out for the same reason `resolveInputs`/`buildOrder` were. */
  private async persist(
    scope: TransactionScope,
    built: BuiltOrder,
    reservation: PreorderReservation,
    now: Date,
  ): Promise<void> {
    const {
      orderRepository,
      reservationRepository,
      postOrderPaymentJournalsUseCase,
      outboxWriter,
    } = this.deps;
    const { order, subOrder, orderItem } = built;

    await orderRepository.withTransaction(scope).create(order);

    const convertedReservation = reservation.recordConvertedOrder(order.id, now);
    await reservationRepository.withTransaction(scope).update(convertedReservation);

    await postOrderPaymentJournalsUseCase.execute(scope, {
      orderId: order.id,
      // No order-module `PaymentAttempt` row exists for a converted
      // reservation — see the class doc comment for why the reservation's
      // own id is used as this traceability string instead.
      paymentAttemptId: reservation.id,
      occurredAt: now,
      subOrders: [
        {
          subOrderId: subOrder.id,
          vendorId: reservation.vendorId,
          total: subOrder.totalAmount,
          commissionLines: [
            { orderItemId: orderItem.id, commissionAmount: orderItem.commissionAmount },
          ],
        },
      ],
    });

    const outbox = outboxWriter.withTransaction(scope);
    await outbox.write({
      aggregateType: ORDER_AUDIT_ENTITY_TYPES.ORDER,
      aggregateId: toUuid(order.id),
      eventType: ORDER_AUDIT_ACTIONS.PLACED,
      payload: { orderId: order.id, customerId: reservation.customerId, subOrderCount: 1 },
    });
    await outbox.write({
      aggregateType: ORDER_AUDIT_ENTITY_TYPES.ORDER,
      aggregateId: toUuid(order.id),
      eventType: ORDER_AUDIT_ACTIONS.CONFIRMED,
      payload: { orderId: order.id, customerId: reservation.customerId },
    });
  }

  async execute(reservationId: ReservationId): Promise<void> {
    const { transactionRunner, clock, logger } = this.deps;

    const inputs = await this.resolveInputs(reservationId);
    const now = clock.now();
    const built = await this.buildOrder(inputs, now);

    await transactionRunner.run((scope) => this.persist(scope, built, inputs.reservation, now));

    logger.info(
      { reservationId, orderId: built.order.id, campaignId: inputs.campaign.id },
      'Preorder reservation converted to order',
    );
  }
}
