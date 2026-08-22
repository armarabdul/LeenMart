import type { IdGenerator } from '@leen-mart/domain-kit';
import type {
  PreorderPaymentConfirmationInput,
  PreorderPaymentConfirmationResult,
  PreorderPaymentGateway,
  PreorderPaymentInitiationInput,
  PreorderPaymentInitiationResult,
} from '../../application/ports/preorder-payment-gateway.port.js';

/**
 * Phase Next's only `PreorderPaymentGateway` implementation — behaviourally
 * identical to the order module's own `MockPaymentGateway` (see the port's
 * own doc comment for why this is a separate class rather than a shared
 * one). Never opens a network connection, never talks to a real provider.
 */
export class MockPreorderPaymentGateway implements PreorderPaymentGateway {
  constructor(private readonly idGenerator: IdGenerator) {}

  initiate(_input: PreorderPaymentInitiationInput): Promise<PreorderPaymentInitiationResult> {
    return Promise.resolve({ providerReference: `MOCK-PREORDER-${this.idGenerator.generate()}` });
  }

  confirm(input: PreorderPaymentConfirmationInput): Promise<PreorderPaymentConfirmationResult> {
    return Promise.resolve({ succeeded: input.testScenario === 'SUCCEEDED' });
  }
}
