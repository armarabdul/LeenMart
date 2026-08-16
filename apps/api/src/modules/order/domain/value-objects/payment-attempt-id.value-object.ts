import { createIdType, type Brand } from '@leen-mart/domain-kit';

export type PaymentAttemptId = Brand<string, 'PaymentAttemptId'>;

const paymentAttemptId = createIdType('PaymentAttemptId');

export const isPaymentAttemptId = paymentAttemptId.is;
export const toPaymentAttemptId = paymentAttemptId.from;
