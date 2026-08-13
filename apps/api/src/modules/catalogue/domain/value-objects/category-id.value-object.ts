import { createIdType, type Brand } from '@leen-mart/domain-kit';

export type CategoryId = Brand<string, 'CategoryId'>;

const categoryId = createIdType('CategoryId');

export const isCategoryId = categoryId.is;
export const toCategoryId = categoryId.from;
