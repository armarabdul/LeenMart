import { describe, expect, it, vi } from 'vitest';
import type { NextFunction, Request, Response } from 'express';
import { z } from 'zod';
import { ValidationError } from '@leen-mart/domain-kit';
import { validate, validatedData } from '../../src/shared/interface/http/middleware/validate.js';

const run = (
  schemas: Parameters<typeof validate>[0],
  req: Partial<Request>,
): { req: Request; error: unknown } => {
  const request = { headers: {}, params: {}, query: {}, body: {}, ...req } as Request;
  let captured: unknown;
  const next = vi.fn((error?: unknown) => {
    captured = error;
  });
  validate(schemas)(request, {} as Response, next as unknown as NextFunction);
  return { req: request, error: captured };
};

describe('validate middleware', () => {
  it('replaces the payload with the parsed, coerced result', () => {
    const { req, error } = run(
      { query: z.object({ limit: z.coerce.number().int() }).strict() },
      { query: { limit: '25' } as unknown as Request['query'] },
    );
    expect(error).toBeUndefined();
    expect(validatedData<unknown, { limit: number }>(req).query.limit).toBe(25);
  });

  it('rejects unrecognised fields, which is what closes the mass-assignment hole', () => {
    const { error } = run(
      { body: z.object({ name: z.string() }).strict() },
      { body: { name: 'Leen', role: 'ADMIN' } },
    );
    expect(error).toBeInstanceOf(ValidationError);
    expect(JSON.stringify((error as ValidationError).details)).toContain('role');
  });

  it('reports failures from every section in one response', () => {
    const { error } = run(
      {
        params: z.object({ id: z.string().uuid() }).strict(),
        body: z.object({ quantity: z.number().int().positive() }).strict(),
      },
      { params: { id: 'nope' } as unknown as Request['params'], body: { quantity: -1 } },
    );
    const details = (error as ValidationError).details;
    expect(details.some((d) => d.field?.startsWith('params'))).toBe(true);
    expect(details.some((d) => d.field?.startsWith('body'))).toBe(true);
  });

  it('prefixes the field path with its request section', () => {
    const { error } = run(
      { body: z.object({ address: z.object({ pincode: z.string().length(6) }) }).strict() },
      { body: { address: { pincode: '12' } } },
    );
    expect((error as ValidationError).details[0]?.field).toBe('body.address.pincode');
  });

  it('does not populate validated data when validation fails', () => {
    const { req } = run({ body: z.object({ a: z.string() }).strict() }, { body: {} });
    expect(req.validated).toBeUndefined();
  });

  it('throws a developer error if a handler reads validated data without the middleware', () => {
    expect(() => validatedData({ headers: {} } as Request)).toThrow(/validate\(\) middleware/);
  });
});
