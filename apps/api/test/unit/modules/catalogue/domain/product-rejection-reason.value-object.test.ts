import { describe, expect, it } from 'vitest';
import { InvalidProductOperationError } from '../../../../../src/modules/catalogue/domain/errors/catalogue-errors.js';
import { ProductRejectionReason } from '../../../../../src/modules/catalogue/domain/value-objects/product-rejection-reason.value-object.js';

describe('ProductRejectionReason', () => {
  it.each([
    'INCOMPLETE_MANDATORY_FIELDS',
    'POLICY_VIOLATION',
    'MISLEADING_LISTING',
    'DUPLICATE_LISTING',
    'PRICING_ISSUE',
    'OTHER',
  ] as const)('resolves %s by name', (name) => {
    expect(ProductRejectionReason.fromName(name).name).toBe(name);
  });

  it('refuses a name outside the closed set', () => {
    expect(() => ProductRejectionReason.fromName('NSFW_IMAGE')).toThrow(
      InvalidProductOperationError,
    );
    expect(() => ProductRejectionReason.fromName('')).toThrow(InvalidProductOperationError);
  });

  it('two instances of the same reason are equal', () => {
    expect(ProductRejectionReason.OTHER.equals(ProductRejectionReason.fromName('OTHER'))).toBe(
      true,
    );
  });

  it('two different reasons are not equal', () => {
    expect(ProductRejectionReason.OTHER.equals(ProductRejectionReason.POLICY_VIOLATION)).toBe(
      false,
    );
  });

  it('stringifies to its name', () => {
    expect(String(ProductRejectionReason.DUPLICATE_LISTING)).toBe('DUPLICATE_LISTING');
  });
});
