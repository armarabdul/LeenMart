import { describe, expect, it } from 'vitest';
import { Money, UuidV7Generator } from '@leen-mart/domain-kit';
import { PaymentAttempt } from '../../../../../src/modules/order/domain/entities/payment-attempt.entity.js';
import { InvalidPaymentAttemptTransitionError } from '../../../../../src/modules/order/domain/errors/order-errors.js';
import { PaymentAttemptStatus } from '../../../../../src/modules/order/domain/value-objects/payment-attempt-status.value-object.js';
import { toPaymentAttemptId } from '../../../../../src/modules/order/domain/value-objects/payment-attempt-id.value-object.js';
import { toOrderId } from '../../../../../src/modules/order/domain/value-objects/order-id.value-object.js';

const ids = new UuidV7Generator();
const NOW = new Date('2026-03-01T00:00:00.000Z');
const LATER = new Date('2026-03-01T00:05:00.000Z');

const buildInitiated = (): PaymentAttempt =>
  PaymentAttempt.initiate({
    id: toPaymentAttemptId(ids.generate()),
    orderId: toOrderId(ids.generate()),
    amount: Money.fromMajor(199),
    provider: 'MOCK',
    providerReference: 'MOCK-ref-1',
    now: NOW,
  });

describe('PaymentAttempt', () => {
  it('starts INITIATED', () => {
    const attempt = buildInitiated();
    expect(attempt.status).toBe(PaymentAttemptStatus.INITIATED);
    expect(attempt.createdAt).toEqual(NOW);
    expect(attempt.updatedAt).toEqual(NOW);
  });

  it('transitions INITIATED -> SUCCEEDED and stamps updatedAt', () => {
    const succeeded = buildInitiated().succeed(LATER);
    expect(succeeded.status).toBe(PaymentAttemptStatus.SUCCEEDED);
    expect(succeeded.updatedAt).toEqual(LATER);
  });

  it('transitions INITIATED -> FAILED and stamps updatedAt', () => {
    const failed = buildInitiated().fail(LATER);
    expect(failed.status).toBe(PaymentAttemptStatus.FAILED);
    expect(failed.updatedAt).toEqual(LATER);
  });

  it('refuses to succeed an already-SUCCEEDED attempt', () => {
    const succeeded = buildInitiated().succeed(LATER);
    expect(() => succeeded.succeed(LATER)).toThrow(InvalidPaymentAttemptTransitionError);
  });

  it('refuses to fail an already-FAILED attempt', () => {
    const failed = buildInitiated().fail(LATER);
    expect(() => failed.fail(LATER)).toThrow(InvalidPaymentAttemptTransitionError);
  });

  it('refuses to succeed an already-FAILED attempt', () => {
    const failed = buildInitiated().fail(LATER);
    expect(() => failed.succeed(LATER)).toThrow(InvalidPaymentAttemptTransitionError);
  });

  it('refuses to fail an already-SUCCEEDED attempt', () => {
    const succeeded = buildInitiated().succeed(LATER);
    expect(() => succeeded.fail(LATER)).toThrow(InvalidPaymentAttemptTransitionError);
  });
});
