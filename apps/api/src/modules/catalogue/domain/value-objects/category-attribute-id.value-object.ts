import { createIdType, type Brand } from '@leen-mart/domain-kit';

export type CategoryAttributeId = Brand<string, 'CategoryAttributeId'>;

const categoryAttributeId = createIdType('CategoryAttributeId');

export const isCategoryAttributeId = categoryAttributeId.is;
export const toCategoryAttributeId = categoryAttributeId.from;
