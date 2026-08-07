import { createIdType, type Brand } from '@leen-mart/domain-kit';

export type VendorId = Brand<string, 'VendorId'>;

const vendorId = createIdType('VendorId');

export const isVendorId = vendorId.is;
export const toVendorId = vendorId.from;
