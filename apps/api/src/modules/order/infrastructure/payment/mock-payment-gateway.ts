import type { IdGenerator } from '@leen-mart/domain-kit';
import type {
  PaymentConfirmationInput,
  PaymentConfirmationResult,
  PaymentGateway,
  PaymentInitiationInput,
  PaymentInitiationResult,
} from '../../application/ports/payment-gateway.port.js';

/**
 * S3-3B's only `PaymentGateway` implementation. Explicitly a **test/demo**
 * adapter — it never opens a network connection, never talks to Razorpay or
 * any other provider, and never claims to. `initiate` mints a reference that
 * is obviously synthetic (`MOCK-…`); `confirm` returns exactly the outcome
 * `testScenario` names, deterministically, never randomly — the same
 * behaviour real payment gateways document for their own sandbox test card
 * numbers. Confirming without a `testScenario` fails closed (`succeeded:
 * false`) rather than defaulting to success.
 *
 * Neither method actually awaits anything — there is no network call to
 * make — so neither is declared `async`; each returns an already-resolved
 * `Promise` directly, satisfying the shared `PaymentGateway` port without a
 * pointless `await` a linter would flag.
 *
 * `initiate`'s `amount` is accepted (matching the port every future adapter
 * shares) but unused here — nothing about a mock provider needs it, though a
 * real one would use it to create the provider-side order. Confirmation's
 * `amount` is likewise accepted but not compared against anything, since
 * there is no external state to compare it to; `ConfirmPaymentUseCase` is
 * what actually enforces "the amount this attempt was initiated for is the
 * order's own persisted total."
 */
export class MockPaymentGateway implements PaymentGateway {
  constructor(private readonly idGenerator: IdGenerator) {}

  initiate(_input: PaymentInitiationInput): Promise<PaymentInitiationResult> {
    return Promise.resolve({ providerReference: `MOCK-${this.idGenerator.generate()}` });
  }

  confirm(input: PaymentConfirmationInput): Promise<PaymentConfirmationResult> {
    return Promise.resolve({ succeeded: input.testScenario === 'SUCCEEDED' });
  }
}
