import { createIdType, type Brand } from '@leen-mart/domain-kit';

export type PickupTokenId = Brand<string, 'PickupTokenId'>;

const pickupTokenId = createIdType('PickupTokenId');

export const isPickupTokenId = pickupTokenId.is;
export const toPickupTokenId = pickupTokenId.from;
