import { describe, expect, it } from 'vitest';
import { Money, UuidV7Generator } from '@leen-mart/domain-kit';
import { MockPaymentGateway } from '../../../../../src/modules/order/infrastructure/payment/mock-payment-gateway.js';
import { toOrderId } from '../../../../../src/modules/order/domain/value-objects/order-id.value-object.js';

const ids = new UuidV7Generator();
const orderId = toOrderId(ids.generate());
const amount = Money.fromMajor(199);

describe('MockPaymentGateway', () => {
  it('initiate() mints an obviously-synthetic provider reference', async () => {
    const gateway = new MockPaymentGateway(ids);
    const result = await gateway.initiate({ orderId, amount });
    expect(result.providerReference).toMatch(/^MOCK-/);
  });

  it('initiate() mints a distinct reference on every call', async () => {
    const gateway = new MockPaymentGateway(ids);
    const first = await gateway.initiate({ orderId, amount });
    const second = await gateway.initiate({ orderId, amount });
    expect(first.providerReference).not.toBe(second.providerReference);
  });

  it('confirm() deterministically succeeds for testScenario: SUCCEEDED', async () => {
    const gateway = new MockPaymentGateway(ids);
    const result = await gateway.confirm({
      providerReference: 'MOCK-ref',
      amount,
      testScenario: 'SUCCEEDED',
    });
    expect(result.succeeded).toBe(true);
  });

  it('confirm() deterministically fails for testScenario: FAILED', async () => {
    const gateway = new MockPaymentGateway(ids);
    const result = await gateway.confirm({
      providerReference: 'MOCK-ref',
      amount,
      testScenario: 'FAILED',
    });
    expect(result.succeeded).toBe(false);
  });

  it('confirm() fails closed when no testScenario is given', async () => {
    const gateway = new MockPaymentGateway(ids);
    const result = await gateway.confirm({ providerReference: 'MOCK-ref', amount });
    expect(result.succeeded).toBe(false);
  });

  it('confirm() is deterministic across repeated calls with the same input', async () => {
    const gateway = new MockPaymentGateway(ids);
    const outcomes = await Promise.all(
      Array.from({ length: 5 }, () =>
        gateway.confirm({ providerReference: 'MOCK-ref', amount, testScenario: 'SUCCEEDED' }),
      ),
    );
    expect(outcomes.every((outcome) => outcome.succeeded)).toBe(true);
  });
});
