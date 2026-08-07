import { createIdType, type Brand } from '@leen-mart/domain-kit';

export type OtpId = Brand<string, 'OtpId'>;

const otpId = createIdType('OtpId');

export const isOtpId = otpId.is;
export const toOtpId = otpId.from;
