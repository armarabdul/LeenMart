import { describe, expect, it } from 'vitest';
import {
  cursorPaginationSchema,
  moneySchema,
  phoneSchema,
  pincodeSchema,
} from '../src/common/primitives.js';
import { errorEnvelopeSchema } from '../src/common/envelope.js';

describe('phoneSchema', () => {
  it('accepts a valid Indian mobile number', () => {
    expect(phoneSchema.parse('+919876543210')).toBe('+919876543210');
  });

  it.each(['9876543210', '+91987654321', '+915876543210', '+1 5551234567', ''])(
    'rejects %s',
    (input) => {
      expect(phoneSchema.safeParse(input).success).toBe(false);
    },
  );
});

describe('pincodeSchema', () => {
  it('accepts a valid PIN code', () => {
    expect(pincodeSchema.parse('400001')).toBe('400001');
  });

  it('rejects a PIN code starting with zero', () => {
    expect(pincodeSchema.safeParse('040001').success).toBe(false);
  });
});

describe('moneySchema', () => {
  it('accepts integer minor units as a string', () => {
    expect(moneySchema.parse({ amount: '149900', currency: 'INR' })).toEqual({
      amount: '149900',
      currency: 'INR',
    });
  });

  it('rejects a decimal amount, which would imply floating-point money', () => {
    expect(moneySchema.safeParse({ amount: '1499.00', currency: 'INR' }).success).toBe(false);
  });
});

describe('cursorPaginationSchema', () => {
  it('defaults the page size', () => {
    expect(cursorPaginationSchema.parse({})).toEqual({ limit: 20 });
  });

  it('coerces a query-string limit', () => {
    expect(cursorPaginationSchema.parse({ limit: '50' }).limit).toBe(50);
  });

  it('enforces the hard ceiling that protects the database', () => {
    expect(cursorPaginationSchema.safeParse({ limit: 5000 }).success).toBe(false);
  });
});

describe('errorEnvelopeSchema', () => {
  it('describes the RFC 7807-style error body', () => {
    const parsed = errorEnvelopeSchema.safeParse({
      error: {
        code: 'VALIDATION_FAILED',
        message: 'The request payload failed validation.',
        details: [{ field: 'phone', issue: 'required' }],
        requestId: '018f1b2c-0000-7000-8000-000000000000',
        timestamp: '2026-08-07T06:00:00.000Z',
      },
    });
    expect(parsed.success).toBe(true);
  });
});
