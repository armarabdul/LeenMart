import type { VendorId } from '../../../identity/index.js';
import type { ProductVariantId } from '../../../catalogue/index.js';
import {
  CampaignFrozenAfterFirstReservationError,
  InvalidCampaignQuantityError,
  InvalidCampaignStatusTransitionError,
  InvalidCampaignWindowError,
} from '../errors/preorder-errors.js';
import {
  CampaignStatus,
  type CampaignStatusName,
} from '../value-objects/campaign-status.value-object.js';
import { type CampaignFulfilmentMode } from '../value-objects/campaign-fulfilment-mode.value-object.js';
import type { CampaignId } from '../value-objects/campaign-id.value-object.js';

export interface CampaignProps {
  readonly id: CampaignId;
  readonly vendorId: VendorId;
  readonly variantId: ProductVariantId;
  readonly status: CampaignStatus;
  readonly opensAt: Date;
  readonly orderCutoffAt: Date;
  readonly fulfilmentWindowStart: Date;
  readonly fulfilmentWindowEnd: Date;
  readonly totalQuantity: number;
  readonly remainingQuantity: number;
  readonly advancePercent: number;
  readonly maxPerCustomer: number;
  readonly fulfilmentMode: CampaignFulfilmentMode;
  readonly firstReservationConfirmedAt: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/**
 * SDD §14.2's exact lifecycle: `DRAFT -> SCHEDULED -> OPEN ->
 * {SOLD_OUT | CLOSED | CANCELLED} -> FULFILLING ->
 * {COMPLETED | PARTIALLY_FULFILLED}`. `SOLD_OUT`/`CLOSED` both mean "no
 * longer accepting reservations" (the diagram's own two branches out of
 * `OPEN`) and both feed into `FULFILLING`.
 *
 * Every transition only accepts its single immediate predecessor — the same
 * "no skip-state transitions" rule `SubOrder.TRANSITIONS` already
 * establishes.
 */
const TRANSITIONS = {
  SCHEDULE: { from: ['DRAFT'], to: CampaignStatus.SCHEDULED },
  OPEN: { from: ['SCHEDULED'], to: CampaignStatus.OPEN },
  MARK_SOLD_OUT: { from: ['OPEN'], to: CampaignStatus.SOLD_OUT },
  CLOSE: { from: ['OPEN'], to: CampaignStatus.CLOSED },
  CANCEL: { from: ['DRAFT', 'SCHEDULED', 'OPEN'], to: CampaignStatus.CANCELLED },
  START_FULFILLING: { from: ['SOLD_OUT', 'CLOSED'], to: CampaignStatus.FULFILLING },
  COMPLETE: { from: ['FULFILLING'], to: CampaignStatus.COMPLETED },
  COMPLETE_PARTIALLY: { from: ['FULFILLING'], to: CampaignStatus.PARTIALLY_FULFILLED },
} satisfies Record<string, { from: readonly CampaignStatusName[]; to: CampaignStatus }>;

type CampaignTransition = keyof typeof TRANSITIONS;

/**
 * A vendor's preorder campaign (SDD §14, "the flagship feature"), attached
 * to a `ProductVariant` — a selling mode, not a product kind (SDD 6.3).
 */
export class PreorderCampaign {
  private constructor(private readonly props: CampaignProps) {}

  static draft(props: {
    id: CampaignId;
    vendorId: VendorId;
    variantId: ProductVariantId;
    opensAt: Date;
    orderCutoffAt: Date;
    fulfilmentWindowStart: Date;
    fulfilmentWindowEnd: Date;
    totalQuantity: number;
    advancePercent: number;
    maxPerCustomer: number;
    fulfilmentMode: CampaignFulfilmentMode;
    now: Date;
  }): PreorderCampaign {
    assertPositiveQuantity(props.totalQuantity);
    assertValidAdvancePercent(props.advancePercent);
    assertPositiveMaxPerCustomer(props.maxPerCustomer);
    assertValidWindow({
      opensAt: props.opensAt,
      orderCutoffAt: props.orderCutoffAt,
      fulfilmentWindowStart: props.fulfilmentWindowStart,
      fulfilmentWindowEnd: props.fulfilmentWindowEnd,
    });

    return new PreorderCampaign({
      id: props.id,
      vendorId: props.vendorId,
      variantId: props.variantId,
      status: CampaignStatus.DRAFT,
      opensAt: props.opensAt,
      orderCutoffAt: props.orderCutoffAt,
      fulfilmentWindowStart: props.fulfilmentWindowStart,
      fulfilmentWindowEnd: props.fulfilmentWindowEnd,
      totalQuantity: props.totalQuantity,
      remainingQuantity: props.totalQuantity,
      advancePercent: props.advancePercent,
      maxPerCustomer: props.maxPerCustomer,
      fulfilmentMode: props.fulfilmentMode,
      firstReservationConfirmedAt: null,
      createdAt: props.now,
      updatedAt: props.now,
    });
  }

  static reconstitute(props: CampaignProps): PreorderCampaign {
    return new PreorderCampaign(props);
  }

  get id(): CampaignId {
    return this.props.id;
  }

  get vendorId(): VendorId {
    return this.props.vendorId;
  }

  get variantId(): ProductVariantId {
    return this.props.variantId;
  }

  get status(): CampaignStatus {
    return this.props.status;
  }

  get opensAt(): Date {
    return this.props.opensAt;
  }

  get orderCutoffAt(): Date {
    return this.props.orderCutoffAt;
  }

  get fulfilmentWindowStart(): Date {
    return this.props.fulfilmentWindowStart;
  }

  get fulfilmentWindowEnd(): Date {
    return this.props.fulfilmentWindowEnd;
  }

  get totalQuantity(): number {
    return this.props.totalQuantity;
  }

  get remainingQuantity(): number {
    return this.props.remainingQuantity;
  }

  get advancePercent(): number {
    return this.props.advancePercent;
  }

  get maxPerCustomer(): number {
    return this.props.maxPerCustomer;
  }

  get fulfilmentMode(): CampaignFulfilmentMode {
    return this.props.fulfilmentMode;
  }

  get firstReservationConfirmedAt(): Date | null {
    return this.props.firstReservationConfirmedAt;
  }

  get createdAt(): Date {
    return this.props.createdAt;
  }

  get updatedAt(): Date {
    return this.props.updatedAt;
  }

  /** Once a reservation has been confirmed, quantity/cutoff/windows are frozen (SDD §14.6). */
  isFrozen(): boolean {
    return this.props.firstReservationConfirmedAt !== null;
  }

  private transition(name: CampaignTransition, now: Date): PreorderCampaign {
    const { from, to } = TRANSITIONS[name];
    if (!(from as readonly CampaignStatusName[]).includes(this.props.status.name)) {
      throw new InvalidCampaignStatusTransitionError(this.props.status.name, to.name);
    }
    return new PreorderCampaign({ ...this.props, status: to, updatedAt: now });
  }

  /**
   * Scheduler-initiated (`SweepCampaignLifecycleUseCase`): `DRAFT` ->
   * `SCHEDULED`, unconditional — no vendor "publish" action exists in this
   * milestone's API surface (the brief names only create/update/cancel/get/
   * list/demand-summary), so every `DRAFT` campaign the sweep sees is
   * promoted the next tick rather than waiting on a gate nothing sets.
   */
  schedule(now: Date): PreorderCampaign {
    return this.transition('SCHEDULE', now);
  }

  /** Scheduler-initiated (`SweepCampaignLifecycleUseCase`): `SCHEDULED` -> `OPEN` at `opens_at`. */
  open(now: Date): PreorderCampaign {
    return this.transition('OPEN', now);
  }

  /** Scheduler-initiated: `OPEN` -> `SOLD_OUT` when `remainingQuantity` reaches 0. */
  markSoldOut(now: Date): PreorderCampaign {
    return this.transition('MARK_SOLD_OUT', now);
  }

  /** Scheduler-initiated: `OPEN` -> `CLOSED` at `order_cutoff_at`. */
  close(now: Date): PreorderCampaign {
    return this.transition('CLOSE', now);
  }

  /** Vendor-initiated (`CancelCampaignUseCase`). No refund call — BR-06/07 remain unresolved; this releases quantity only. */
  cancel(now: Date): PreorderCampaign {
    return this.transition('CANCEL', now);
  }

  startFulfilling(now: Date): PreorderCampaign {
    return this.transition('START_FULFILLING', now);
  }

  complete(now: Date): PreorderCampaign {
    return this.transition('COMPLETE', now);
  }

  completePartially(now: Date): PreorderCampaign {
    return this.transition('COMPLETE_PARTIALLY', now);
  }

  /**
   * Marks the campaign frozen — called exactly once, the moment the first
   * reservation reaches `CONFIRMED` (idempotent: a second call is a no-op).
   */
  markFirstReservationConfirmed(now: Date): PreorderCampaign {
    if (this.props.firstReservationConfirmedAt !== null) return this;
    return new PreorderCampaign({
      ...this.props,
      firstReservationConfirmedAt: now,
      updatedAt: now,
    });
  }

  /**
   * Pre-open edit (`UpdateCampaignUseCase`). Once frozen, `totalQuantity` may
   * only increase and `orderCutoffAt`/the fulfilment window may not change at
   * all (SDD §14.6) — both guards throw `CampaignFrozenAfterFirstReservation
   * Error` naming the offending field, rather than silently ignoring the
   * attempted change.
   */
  update(
    changes: {
      opensAt?: Date;
      orderCutoffAt?: Date;
      fulfilmentWindowStart?: Date;
      fulfilmentWindowEnd?: Date;
      totalQuantity?: number;
      advancePercent?: number;
      maxPerCustomer?: number;
      fulfilmentMode?: CampaignFulfilmentMode;
    },
    now: Date,
  ): PreorderCampaign {
    const frozen = this.isFrozen();
    assertFrozenWindowUnchanged(frozen, changes, this.props);
    const { nextTotalQuantity, nextRemainingQuantity } = resolveQuantityChange(
      frozen,
      changes.totalQuantity,
      this.props.totalQuantity,
      this.props.remainingQuantity,
    );

    const nextOpensAt = changes.opensAt ?? this.props.opensAt;
    const nextOrderCutoffAt = changes.orderCutoffAt ?? this.props.orderCutoffAt;
    const nextFulfilmentWindowStart =
      changes.fulfilmentWindowStart ?? this.props.fulfilmentWindowStart;
    const nextFulfilmentWindowEnd = changes.fulfilmentWindowEnd ?? this.props.fulfilmentWindowEnd;
    assertValidWindow({
      opensAt: nextOpensAt,
      orderCutoffAt: nextOrderCutoffAt,
      fulfilmentWindowStart: nextFulfilmentWindowStart,
      fulfilmentWindowEnd: nextFulfilmentWindowEnd,
    });

    if (changes.advancePercent !== undefined) assertValidAdvancePercent(changes.advancePercent);
    if (changes.maxPerCustomer !== undefined) assertPositiveMaxPerCustomer(changes.maxPerCustomer);

    return new PreorderCampaign({
      ...this.props,
      opensAt: nextOpensAt,
      orderCutoffAt: nextOrderCutoffAt,
      fulfilmentWindowStart: nextFulfilmentWindowStart,
      fulfilmentWindowEnd: nextFulfilmentWindowEnd,
      totalQuantity: nextTotalQuantity,
      remainingQuantity: nextRemainingQuantity,
      advancePercent: changes.advancePercent ?? this.props.advancePercent,
      maxPerCustomer: changes.maxPerCustomer ?? this.props.maxPerCustomer,
      fulfilmentMode: changes.fulfilmentMode ?? this.props.fulfilmentMode,
      updatedAt: now,
    });
  }
}

const assertPositiveQuantity = (quantity: number): void => {
  if (!Number.isInteger(quantity) || quantity <= 0) {
    throw new InvalidCampaignQuantityError('Must be a positive whole number.');
  }
};

/** `update()`'s own frozen-window guard, split out purely to keep that method within this repository's complexity budget. Each field is checked independently so the error always names the one the caller actually tried to change. */
const assertFrozenWindowUnchanged = (
  frozen: boolean,
  changes: {
    readonly orderCutoffAt?: Date;
    readonly fulfilmentWindowStart?: Date;
    readonly fulfilmentWindowEnd?: Date;
  },
  current: {
    readonly orderCutoffAt: Date;
    readonly fulfilmentWindowStart: Date;
    readonly fulfilmentWindowEnd: Date;
  },
): void => {
  if (!frozen) return;
  const fields = ['orderCutoffAt', 'fulfilmentWindowStart', 'fulfilmentWindowEnd'] as const;
  for (const field of fields) {
    const next = changes[field];
    if (next !== undefined && next.getTime() !== current[field].getTime()) {
      throw new CampaignFrozenAfterFirstReservationError(field);
    }
  }
};

/** `update()`'s own quantity-change resolution, split out for the same reason `assertFrozenWindowUnchanged` was. */
const resolveQuantityChange = (
  frozen: boolean,
  nextTotalQuantity: number | undefined,
  currentTotalQuantity: number,
  currentRemainingQuantity: number,
): { readonly nextTotalQuantity: number; readonly nextRemainingQuantity: number } => {
  if (nextTotalQuantity === undefined || nextTotalQuantity === currentTotalQuantity) {
    return {
      nextTotalQuantity: currentTotalQuantity,
      nextRemainingQuantity: currentRemainingQuantity,
    };
  }
  assertPositiveQuantity(nextTotalQuantity);
  if (frozen && nextTotalQuantity < currentTotalQuantity) {
    throw new CampaignFrozenAfterFirstReservationError('totalQuantity');
  }
  const delta = nextTotalQuantity - currentTotalQuantity;
  return { nextTotalQuantity, nextRemainingQuantity: currentRemainingQuantity + delta };
};

const assertValidAdvancePercent = (percent: number): void => {
  if (!Number.isInteger(percent) || percent < 0 || percent > 100) {
    throw new InvalidCampaignQuantityError('advancePercent must be an integer between 0 and 100.');
  }
};

const assertPositiveMaxPerCustomer = (max: number): void => {
  if (!Number.isInteger(max) || max <= 0) {
    throw new InvalidCampaignQuantityError('maxPerCustomer must be a positive whole number.');
  }
};

const assertValidWindow = (window: {
  opensAt: Date;
  orderCutoffAt: Date;
  fulfilmentWindowStart: Date;
  fulfilmentWindowEnd: Date;
}): void => {
  if (window.orderCutoffAt.getTime() < window.opensAt.getTime()) {
    throw new InvalidCampaignWindowError('orderCutoffAt must not precede opensAt.');
  }
  if (window.fulfilmentWindowEnd.getTime() <= window.fulfilmentWindowStart.getTime()) {
    throw new InvalidCampaignWindowError(
      'fulfilmentWindowEnd must be after fulfilmentWindowStart.',
    );
  }
  if (window.fulfilmentWindowStart.getTime() < window.orderCutoffAt.getTime()) {
    throw new InvalidCampaignWindowError('fulfilmentWindowStart must not precede orderCutoffAt.');
  }
};
