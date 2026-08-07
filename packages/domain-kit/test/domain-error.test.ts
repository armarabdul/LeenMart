import { describe, expect, it } from 'vitest';
import {
  ConflictError,
  DomainRuleError,
  IntegrationError,
  isAppError,
  NotFoundError,
  ValidationError,
} from '../src/errors/domain-error.js';

describe('error taxonomy', () => {
  it('carries a stable machine-readable code', () => {
    expect(new NotFoundError().code).toBe('NOT_FOUND');
    expect(new ConflictError('sold out', { code: 'PREORDER_SOLD_OUT' }).code).toBe(
      'PREORDER_SOLD_OUT',
    );
    expect(new DomainRuleError('COD_NOT_ELIGIBLE', 'COD unavailable').code).toBe(
      'COD_NOT_ELIGIBLE',
    );
  });

  it('classifies errors by kind so the HTTP mapper stays exhaustive', () => {
    expect(new ValidationError().kind).toBe('VALIDATION');
    expect(new NotFoundError().kind).toBe('NOT_FOUND');
    expect(new IntegrationError('razorpay', 'timeout').kind).toBe('INTEGRATION');
  });

  it('preserves field-level detail', () => {
    const error = new ValidationError('bad', { details: [{ field: 'phone', issue: 'required' }] });
    expect(error.details).toEqual([{ field: 'phone', issue: 'required' }]);
  });

  it('preserves the underlying cause without leaking it to clients', () => {
    const cause = new Error('ECONNRESET');
    const error = new IntegrationError('razorpay', 'Payment gateway unavailable', { cause });
    expect(error.cause).toBe(cause);
    expect(error.message).not.toContain('ECONNRESET');
  });

  it('is recognisable by the global error handler', () => {
    expect(isAppError(new NotFoundError())).toBe(true);
    expect(isAppError(new Error('plain'))).toBe(false);
  });
});
