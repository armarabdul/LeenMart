import type { Money } from '@leen-mart/domain-kit';
import { InvalidPaymentAttemptTransitionError } from '../errors/order-errors.js';
import {
  PaymentAttemptStatus,
  type PaymentAttemptStatusName,
} from '../value-objects/payment-attempt-status.value-object.js';
import type { PaymentAttemptId } from '../value-objects/payment-attempt-id.value-object.js';
import type { OrderId } from '../value-objects/order-id.value-object.js';

/** The only provider this milestone ever writes — see `MockPaymentGateway`'s own doc comment for why this is not a free-text column. */
export type PaymentProvider = 'MOCK';

export interface PaymentAttemptProps {
  readonly id: PaymentAttemptId;
  readonly orderId: OrderId;
  readonly status: PaymentAttemptStatus;
  /** The order's own persisted total at the moment this attempt was initiated — never a client-supplied figure (SEC-02). */
  readonly amount: Money;
  readonly provider: PaymentProvider;
  /** The mock gateway's own generated reference (S3-3B) — never a real provider transaction id. */
  readonly providerReference: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

const TRANSITIONS = {
  SUCCEED: { from: ['INITIATED'], to: PaymentAttemptStatus.SUCCEEDED },
  FAIL: { from: ['INITIATED'], to: PaymentAttemptStatus.FAILED },
} satisfies Record<string, { from: readonly PaymentAttemptStatusName[]; to: PaymentAttemptStatus }>;

/**
 * One attempt to pay for an order (S3-3B). Not the full SDD 10.4 `payments`
 * aggregate — see `payment-attempt-status.value-object.ts`'s own comment for
 * why. Always scoped to exactly one `Order`; a failed attempt does not
 * mutate the order at all, so a customer can retry by initiating a fresh
 * attempt (a new row, never a reused one — `payment_attempts` rows are
 * append-only once resolved, matching this schema's own §6.1 convention for
 * financial-adjacent tables).
 */
export class PaymentAttempt {
  private constructor(private readonly props: PaymentAttemptProps) {}

  static initiate(props: {
    id: PaymentAttemptId;
    orderId: OrderId;
    amount: Money;
    provider: PaymentProvider;
    providerReference: string;
    now: Date;
  }): PaymentAttempt {
    return new PaymentAttempt({
      id: props.id,
      orderId: props.orderId,
      status: PaymentAttemptStatus.INITIATED,
      amount: props.amount,
      provider: props.provider,
      providerReference: props.providerReference,
      createdAt: props.now,
      updatedAt: props.now,
    });
  }

  static reconstitute(props: PaymentAttemptProps): PaymentAttempt {
    return new PaymentAttempt(props);
  }

  get id(): PaymentAttemptId {
    return this.props.id;
  }

  get orderId(): OrderId {
    return this.props.orderId;
  }

  get status(): PaymentAttemptStatus {
    return this.props.status;
  }

  get amount(): Money {
    return this.props.amount;
  }

  get provider(): PaymentProvider {
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

  private transition(name: keyof typeof TRANSITIONS, now: Date): PaymentAttempt {
    const { from, to } = TRANSITIONS[name];
    if (!(from as readonly PaymentAttemptStatusName[]).includes(this.props.status.name)) {
      throw new InvalidPaymentAttemptTransitionError(this.props.status.name, to.name);
    }
    return new PaymentAttempt({ ...this.props, status: to, updatedAt: now });
  }

  succeed(now: Date): PaymentAttempt {
    return this.transition('SUCCEED', now);
  }

  fail(now: Date): PaymentAttempt {
    return this.transition('FAIL', now);
  }
}
