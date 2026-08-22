import {
  toUuid,
  type Clock,
  type IdGenerator,
  type Logger,
  type TransactionRunner,
} from '@leen-mart/domain-kit';
import type { AddressId, AddressRepository } from '../../../customer/index.js';
import type { UserId } from '../../../identity/index.js';
import type { ProductVariant } from '../../../catalogue/domain/entities/product-variant.entity.js';
import type { ProductVariantRepository } from '../../../catalogue/domain/repositories/product-variant.repository.js';
import type { OutboxWriter } from '../../../../shared/application/ports/outbox-writer.port.js';
import type { PreorderCampaign } from '../../domain/entities/preorder-campaign.entity.js';
import {
  PreorderReservation,
  type ReservationFulfilmentMode,
} from '../../domain/entities/preorder-reservation.entity.js';
import {
  CampaignNotAvailableError,
  CampaignNotFoundError,
  FulfilmentModeNotOfferedError,
  MaxPerCustomerExceededError,
  ReservationAddressNotFoundError,
  VariantNotEligibleForCampaignError,
} from '../../domain/errors/preorder-errors.js';
import { PREORDER_OUTBOX_EVENTS } from '../../domain/outbox-events.js';
import { PREORDER_AUDIT_ENTITY_TYPES } from '../../domain/audit-actions.js';
import type { CampaignRepository } from '../../domain/repositories/campaign.repository.js';
import type { ReservationRepository } from '../../domain/repositories/reservation.repository.js';
import type { CampaignId } from '../../domain/value-objects/campaign-id.value-object.js';
import { toReservationId } from '../../domain/value-objects/reservation-id.value-object.js';
import type { RedisCampaignQuotaGate } from '../../infrastructure/cache/redis-campaign-quota-gate.js';

export interface CreateReservationInput {
  readonly customerId: UserId;
  readonly campaignId: CampaignId;
  readonly quantity: number;
  /** Validated against `campaign.fulfilmentMode.allows(...)` below — see `CampaignFulfilmentMode`'s own doc comment for why this is captured here rather than left for conversion to infer. */
  readonly fulfilmentMode: ReservationFulfilmentMode;
  /** Ownership validated against `addressRepository` below — only the reference is stored; `ConvertReservationToOrderUseCase` re-resolves and snapshots the live address at conversion time (see `PreorderReservation.addressId`'s own doc comment). */
  readonly addressId: AddressId;
}

export interface CreateReservationDeps {
  readonly campaignRepository: CampaignRepository;
  readonly reservationRepository: ReservationRepository;
  /** Bound to the plain, non-RLS client — the same credential `PlaceOrderUseCase` reads addresses on. */
  readonly addressRepository: AddressRepository;
  /** `publicPrisma`-bound, the exact `AddCartItemUseCase`/`PlaceOrderUseCase` precedent for a customer-session read of a `catalogue`-owned variant. */
  readonly productVariantRepository: ProductVariantRepository;
  readonly quotaGate: RedisCampaignQuotaGate;
  readonly transactionRunner: TransactionRunner;
  readonly outboxWriter: OutboxWriter;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
  readonly logger: Logger;
  /** 10 minutes (ASM-11) — injected rather than hard-coded so a test can shrink it. */
  readonly reservationTtlMs: number;
}

/**
 * SDD §14.4's three-layer concurrency design, end to end. **This is the one
 * place all three layers meet.**
 *
 * Layer 1 (Redis): `quotaGate.tryReserve` — a single atomic Lua
 * check-and-decrement. A `REJECTED` outcome returns immediately, before
 * Postgres is ever touched — this is the thundering-herd shed.
 *
 * Layer 2 (Postgres): `campaignRepository.decrementRemainingIfAvailable` —
 * one atomic conditional `UPDATE`, inside the same transaction as the
 * reservation row's own `INSERT` and the outbox write. This is the
 * correctness authority; Redis agreeing or disagreeing changes nothing
 * about whether this succeeds. A `false` result here after Redis admitted
 * the request (drift, or Redis having no counter for this campaign yet)
 * compensates by releasing the Redis-side reservation right back — the
 * gate must never end up permanently short an admitted-but-rejected slot.
 *
 * Layer 3 (reconciliation): not this use case's concern at all —
 * `ReconcileRedisQuantityUseCase` runs independently on its own schedule.
 *
 * The held quantity occupies capacity from the moment this method returns,
 * not from confirmation (`PENDING`, `expiresAt` = now + 10 min, ASM-11) — a
 * soft hold must itself hold the capacity it claims, which is exactly why
 * the decrement happens here rather than being deferred to
 * `ConfirmReservationPaymentUseCase`.
 */
export class CreateReservationUseCase {
  constructor(private readonly deps: CreateReservationDeps) {}

  /**
   * Every pre-transaction check, in one place, purely to keep `execute`
   * itself within this repository's complexity budget. Nothing here writes
   * anything — a plain resolve-or-throw pass ahead of the concurrency-critical
   * transaction below.
   */
  private async resolveCampaignAndVariant(
    input: CreateReservationInput,
  ): Promise<{ readonly campaign: PreorderCampaign; readonly variant: ProductVariant }> {
    const {
      campaignRepository,
      reservationRepository,
      addressRepository,
      productVariantRepository,
    } = this.deps;

    if (!Number.isInteger(input.quantity) || input.quantity <= 0) {
      throw new CampaignNotAvailableError();
    }

    const address = await addressRepository.findById(input.addressId, input.customerId);
    if (!address) throw new ReservationAddressNotFoundError();

    const campaign = await campaignRepository.findById(input.campaignId);
    if (!campaign) throw new CampaignNotFoundError();
    if (campaign.status.name !== 'OPEN') throw new CampaignNotAvailableError();
    if (!campaign.fulfilmentMode.allows(input.fulfilmentMode)) {
      throw new FulfilmentModeNotOfferedError();
    }

    const alreadyHeld = await reservationRepository.sumActiveQuantityForCustomer(
      campaign.id,
      input.customerId,
    );
    if (alreadyHeld + input.quantity > campaign.maxPerCustomer) {
      throw new MaxPerCustomerExceededError(campaign.maxPerCustomer);
    }

    const variant = await productVariantRepository.findById(campaign.variantId);
    if (!variant) throw new VariantNotEligibleForCampaignError();

    return { campaign, variant };
  }

  /**
   * Layer 2 and the reservation write, in one transaction — split out purely
   * to keep `execute` itself within this repository's complexity budget.
   */
  private async placeReservationInTransaction(
    campaign: PreorderCampaign,
    input: CreateReservationInput,
    pricing: {
      readonly unitPrice: ProductVariant['price'];
      readonly advanceAmount: ProductVariant['price'];
      readonly balanceAmount: ProductVariant['price'];
    },
    now: Date,
  ): Promise<PreorderReservation> {
    const {
      campaignRepository,
      reservationRepository,
      outboxWriter,
      transactionRunner,
      idGenerator,
      reservationTtlMs,
    } = this.deps;

    return transactionRunner.run(async (scope) => {
      const campaigns = campaignRepository.withTransaction(scope);
      const reservations = reservationRepository.withTransaction(scope);

      // Layer 2 — the correctness authority.
      const decremented = await campaigns.decrementRemainingIfAvailable(
        campaign.id,
        input.quantity,
      );
      if (!decremented) {
        throw new CampaignNotAvailableError();
      }

      const reservation = PreorderReservation.create({
        id: toReservationId(idGenerator.generate()),
        campaignId: campaign.id,
        customerId: input.customerId,
        vendorId: campaign.vendorId,
        quantity: input.quantity,
        fulfilmentMode: input.fulfilmentMode,
        addressId: input.addressId,
        unitPrice: pricing.unitPrice,
        advanceAmount: pricing.advanceAmount,
        balanceAmount: pricing.balanceAmount,
        expiresAt: new Date(now.getTime() + reservationTtlMs),
        now,
      });
      await reservations.create(reservation);

      await outboxWriter.withTransaction(scope).write({
        aggregateType: PREORDER_AUDIT_ENTITY_TYPES.CAMPAIGN,
        aggregateId: toUuid(campaign.id),
        eventType: PREORDER_OUTBOX_EVENTS.RESERVATION_CREATED,
        payload: {
          campaignId: campaign.id,
          reservationId: reservation.id,
          customerId: input.customerId,
          quantity: input.quantity,
        },
      });

      return reservation;
    });
  }

  async execute(input: CreateReservationInput): Promise<PreorderReservation> {
    const { quotaGate, clock, logger } = this.deps;

    const { campaign, variant } = await this.resolveCampaignAndVariant(input);

    // Layer 1 — the admission gate. `UNKNOWN` (no counter yet, or Redis
    // unavailable) fails open: Postgres alone still guarantees correctness.
    const gateOutcome = await quotaGate.tryReserve(campaign.id, input.quantity);
    if (gateOutcome === 'REJECTED') {
      throw new CampaignNotAvailableError();
    }

    const now = clock.now();
    const unitPrice = variant.price;
    const lineTotal = unitPrice.multiply(input.quantity);
    const advanceAmount = lineTotal.percentageOf(campaign.advancePercent);
    const balanceAmount = lineTotal.subtract(advanceAmount);

    try {
      return await this.placeReservationInTransaction(
        campaign,
        input,
        { unitPrice, advanceAmount, balanceAmount },
        now,
      );
    } catch (error) {
      // Compensate the Redis-side admission if Postgres ultimately refused —
      // the gate must never end up short a slot nobody actually holds.
      if (gateOutcome === 'RESERVED') {
        await quotaGate.release(campaign.id, input.quantity).catch((releaseError: unknown) => {
          logger.error(
            { err: releaseError, campaignId: campaign.id },
            'Failed to release quota-gate compensation',
          );
        });
      }
      throw error;
    } finally {
      logger.info(
        { campaignId: campaign.id, customerId: input.customerId, quantity: input.quantity },
        'Preorder reservation attempt processed',
      );
    }
  }
}
