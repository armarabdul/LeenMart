import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { z, ZodTypeAny } from 'zod';
import { ValidationError } from '@leen-mart/domain-kit';

/**
 * Request validation at the transport boundary (SDD 24 / SEC-12).
 *
 * Every schema is `.strict()` by convention: an unrecognised field is rejected
 * rather than silently ignored. Combined with never spreading a request body
 * into an ORM call, this closes the mass-assignment hole that lets a client set
 * its own `role`.
 */
export interface ValidationSchemas {
  readonly body?: ZodTypeAny;
  readonly query?: ZodTypeAny;
  readonly params?: ZodTypeAny;
  readonly headers?: ZodTypeAny;
}

export interface ValidatedData<TBody = unknown, TQuery = unknown, TParams = unknown> {
  readonly body: TBody;
  readonly query: TQuery;
  readonly params: TParams;
}

declare module 'express-serve-static-core' {
  interface Request {
    /** Populated by `validate()`. Handlers read this, never `req.body`. */
    validated?: ValidatedData;
  }
}

const collect = (error: z.ZodError, section: string): { field: string; issue: string }[] =>
  error.issues.map((issue) => ({
    field: [section, ...issue.path.map(String)].filter(Boolean).join('.'),
    issue: issue.message,
  }));

/**
 * Validates and *replaces* the request payload with the parsed result, so
 * downstream code works with coerced, trusted values rather than raw strings.
 */
export const validate = (schemas: ValidationSchemas): RequestHandler => {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const details: { field: string; issue: string }[] = [];
    const validated: { body: unknown; query: unknown; params: unknown } = {
      body: undefined,
      query: undefined,
      params: undefined,
    };

    if (schemas.headers) {
      const result = schemas.headers.safeParse(req.headers);
      if (!result.success) details.push(...collect(result.error, 'headers'));
    }

    if (schemas.params) {
      const result = schemas.params.safeParse(req.params);
      if (result.success) validated.params = result.data;
      else details.push(...collect(result.error, 'params'));
    }

    if (schemas.query) {
      const result = schemas.query.safeParse(req.query);
      if (result.success) validated.query = result.data;
      else details.push(...collect(result.error, 'query'));
    }

    if (schemas.body) {
      const result = schemas.body.safeParse(req.body);
      if (result.success) validated.body = result.data;
      else details.push(...collect(result.error, 'body'));
    }

    if (details.length > 0) {
      next(new ValidationError('The request payload failed validation.', { details }));
      return;
    }

    req.validated = validated;
    next();
  };
};

/** Reads the validated payload with the caller's expected types. */
export const validatedData = <TBody = unknown, TQuery = unknown, TParams = unknown>(
  req: Request,
): ValidatedData<TBody, TQuery, TParams> => {
  if (!req.validated) {
    throw new Error('validatedData() called on a route without the validate() middleware.');
  }
  return req.validated as ValidatedData<TBody, TQuery, TParams>;
};
