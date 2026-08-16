import type { Money } from '@leen-mart/domain-kit';
import type { OrderId } from '../../domain/value-objects/order-id.value-object.js';

export interface PaymentInitiationInput {
  readonly orderId: OrderId;
  /** The order's own persisted total, resolved server-side — never a client-supplied figure (SEC-02). */
  readonly amount: Money;
}

export interface PaymentInitiationResult {
  /** The provider's own reference for this attempt — never derived from anything a caller supplies. */
  readonly providerReference: string;
}

/**
 * Selects which deterministic outcome a *test* adapter returns — present
 * only because S3-3B's own adapter is a mock. A real gateway adapter has no
 * use for this field and production traffic never sets it; this is the same
 * shape real payment gateways already use in their own sandboxes (specific
 * test card numbers that deterministically succeed or fail) rather than
 * anything specific to this codebase.
 */
export type PaymentTestScenario = 'SUCCEEDED' | 'FAILED';

export interface PaymentConfirmationInput {
  readonly providerReference: string;
  /** The order's own persisted total — never a client-supplied figure (SEC-02). Real gateways verify `captured_amount == order.total` against this same value (SDD 10.5). */
  readonly amount: Money;
  readonly testScenario?: PaymentTestScenario;
}

export interface PaymentConfirmationResult {
  readonly succeeded: boolean;
}

/**
 * The seam between `order` and whatever actually moves money (S3-3B).
 * Mirrors `ObjectStore`'s own shape (`media/application/ports/object-store.port.ts`):
 * a narrow port in `application/ports/`, a concrete adapter in
 * `infrastructure/`, nothing gateway-specific ever named outside the
 * adapter. `MockPaymentGateway` is the only implementation this milestone
 * ships — swapping in a real Razorpay adapter later changes nothing on this
 * port's callers.
 */
export interface PaymentGateway {
  /** Starts one payment attempt with the provider. No side effect on the order itself — the use case decides what to persist. */
  initiate(input: PaymentInitiationInput): Promise<PaymentInitiationResult>;

  /**
   * Resolves whether an already-initiated attempt succeeded. A real adapter
   * would query the provider (or have already learned the answer from a
   * verified webhook); this method's contract is "tell me the outcome for
   * this reference," not "wait for a callback" — the difference is invisible
   * to callers on either side of the port.
   */
  confirm(input: PaymentConfirmationInput): Promise<PaymentConfirmationResult>;
}
