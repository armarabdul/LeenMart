import { createIdType, type Brand } from '@leen-mart/domain-kit';

export type ProductMediaId = Brand<string, 'ProductMediaId'>;

const productMediaId = createIdType('ProductMediaId');

export const isProductMediaId = productMediaId.is;
export const toProductMediaId = productMediaId.from;
