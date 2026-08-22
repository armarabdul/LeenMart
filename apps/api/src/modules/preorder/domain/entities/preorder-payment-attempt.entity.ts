import type { Money } from '@leen-mart/domain-kit';
import { InvalidPaymentAttemptTransitionError } from '../errors/preorder-errors.js';
import type { PreorderPaymentAttemptId } from '../value-objects/payment-attempt-id.value-object.js';
import type { ReservationId } from '../value-objects/reservation-id.value-object.js';
import {
  PaymentAttemptStatus,
  type PaymentAttemptStatusName,
} from '../value-objects/payment-attempt-status.value-object.js';

export type PreorderPaymentAttemptKind = 'ADVANCE' | 'BALANCE';

/** The only provider this milestone ever writes — mirrors `PaymentAttempt`'s own `PaymentProvider` reasoning exactly. */
export type PreorderPaymentProvider = 'MOCK';

export interface PreorderPaymentAttemptProps {
  readonly id: PreorderPaymentAttemptId;
  readonly reservationId: ReservationId;
  readonly kind: PreorderPaymentAttemptKind;
  readonly status: PaymentAttemptStatus;
  readonly amount: Money;
  readonly provider: PreorderPaymentProvider;
  readonly providerReference: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

const TRANSITIONS = {
  SUCCEED: { from: ['INITIATED'], to: PaymentAttemptStatus.SUCCEEDED },
  FAIL: { from: ['INITIATED'], to: PaymentAttemptStatus.FAILED },
} satisfies Record<string, { from: readonly PaymentAttemptStatusName[]; to: PaymentAttemptStatus }>;

/**
 * One attempt to pay a reservation's advance or balance (Phase Next).
 * Deliberately **not** the order module's own `PaymentAttempt` — a
 * reservation is not yet an `Order` at advance-payment time, and reaching
 * into another module's table for a row that is properly this module's own
 * concern is exactly what SDD 5.1's module-boundary rule argues against.
 * Append-only once resolved, the same `PaymentAttempt` convention.
 */
export class PreorderPaymentAttempt {
  private constructor(private readonly props: PreorderPaymentAttemptProps) {}

  static initiate(props: {
    id: PreorderPaymentAttemptId;
    reservationId: ReservationId;
    kind: PreorderPaymentAttemptKind;
    amount: Money;
    provider: PreorderPaymentProvider;
    providerReference: string;
    now: Date;
  }): PreorderPaymentAttempt {
    return new PreorderPaymentAttempt({
      id: props.id,
      reservationId: props.reservationId,
      kind: props.kind,
      status: PaymentAttemptStatus.INITIATED,
      amount: props.amount,
      provider: props.provider,
      providerReference: props.providerReference,
      createdAt: props.now,
      updatedAt: props.now,
    });
  }

  static reconstitute(props: PreorderPaymentAttemptProps): PreorderPaymentAttempt {
    return new PreorderPaymentAttempt(props);
  }

  get id(): PreorderPaymentAttemptId {
    return this.props.id;
  }

  get reservationId(): ReservationId {
    return this.props.reservationId;
  }

  get kind(): PreorderPaymentAttemptKind {
    return this.props.kind;
  }

  get status(): PaymentAttemptStatus {
    return this.props.status;
  }

  get amount(): Money {
    return this.props.amount;
  }

  get provider(): PreorderPaymentProvider {
    return this.props.provider;
  }

  get providerReference(): string {
    return this.props.providerReference;
  }

  get createdAt(): Date {
    return this.props.createdAt;
  }

  get updatedAt(): Date {
    return this.props.updatedAt;
  }

  private transition(name: keyof typeof TRANSITIONS, now: Date): PreorderPaymentAttempt {
    const { from, to } = TRANSITIONS[name];
    if (!(from as readonly PaymentAttemptStatusName[]).includes(this.props.status.name)) {
      throw new InvalidPaymentAttemptTransitionError(this.props.status.name, to.name);
    }
    return new PreorderPaymentAttempt({ ...this.props, status: to, updatedAt: now });
  }

  succeed(now: Date): PreorderPaymentAttempt {
    return this.transition('SUCCEED', now);
  }

  fail(now: Date): PreorderPaymentAttempt {
    return this.transition('FAIL', now);
  }
}
