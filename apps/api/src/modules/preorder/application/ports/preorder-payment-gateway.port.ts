import type { Money } from '@leen-mart/domain-kit';

/**
 * A narrow, preorder-local mirror of `order`'s own `PaymentGateway` port —
 * **not a reuse of it**, and this is deliberate, not an oversight.
 *
 * Architectural note (per the implementation brief's own "stop and report a
 * mismatch rather than modify the global payment architecture" instruction):
 * `order`'s `PaymentGateway.initiate()`/`confirm()` types their input as
 * `{ orderId: OrderId, ... }` — coupled to the order module's own branded id
 * at the type level. A reservation is not an `Order` at advance-payment
 * time, so that port cannot be called for this step without either widening
 * its type (a change to shared, order-owned code the brief explicitly
 * forbids) or fabricating a fake `OrderId` (unsafe). `MockPaymentGateway`'s
 * own implementation never actually reads `orderId` — `initiate(_input)`
 * ignores its whole argument — so the coupling is a type-level accident, not
 * a real behavioural dependency, which is exactly why duplicating this tiny
 * port rather than touching the shared one is the safe, minimal fix: zero
 * lines of `order`-owned code change, and preorder's mock behaves
 * identically (same reference format, same deterministic test-scenario
 * outcome, no network call, ever).
 */
export interface PreorderPaymentInitiationInput {
  readonly referenceId: string;
  readonly amount: Money;
}

export interface PreorderPaymentInitiationResult {
  readonly providerReference: string;
}

export type PreorderPaymentTestScenario = 'SUCCEEDED' | 'FAILED';

export interface PreorderPaymentConfirmationInput {
  readonly providerReference: string;
  readonly amount: Money;
  readonly testScenario?: PreorderPaymentTestScenario;
}

export interface PreorderPaymentConfirmationResult {
  readonly succeeded: boolean;
}

export interface PreorderPaymentGateway {
  initiate(input: PreorderPaymentInitiationInput): Promise<PreorderPaymentInitiationResult>;
  confirm(input: PreorderPaymentConfirmationInput): Promise<PreorderPaymentConfirmationResult>;
}
