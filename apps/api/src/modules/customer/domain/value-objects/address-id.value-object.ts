import { createIdType, type Brand } from '@leen-mart/domain-kit';

export type AddressId = Brand<string, 'AddressId'>;

const addressId = createIdType('AddressId');

export const isAddressId = addressId.is;
export const toAddressId = addressId.from;
