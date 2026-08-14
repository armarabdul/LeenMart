import { createIdType, type Brand } from '@leen-mart/domain-kit';

export type ProductMediaVariantId = Brand<string, 'ProductMediaVariantId'>;

const productMediaVariantId = createIdType('ProductMediaVariantId');

export const isProductMediaVariantId = productMediaVariantId.is;
export const toProductMediaVariantId = productMediaVariantId.from;
