import { createIdType, type Brand } from '@leen-mart/domain-kit';

export type PreorderPaymentAttemptId = Brand<string, 'PreorderPaymentAttemptId'>;

const paymentAttemptId = createIdType('PreorderPaymentAttemptId');

export const isPreorderPaymentAttemptId = paymentAttemptId.is;
export const toPreorderPaymentAttemptId = paymentAttemptId.from;
