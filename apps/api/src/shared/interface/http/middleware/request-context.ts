import { AsyncLocalStorage } from 'node:async_hooks';
import type { NextFunction, Request, Response } from 'express';
import type { IdGenerator } from '@leen-mart/domain-kit';

export interface RequestContext {
  readonly requestId: string;
  readonly startedAt: number;
}

const storage = new AsyncLocalStorage<RequestContext>();

/** Returns the ambient request context, if the caller is inside a request. */
export const getRequestContext = (): RequestContext | undefined => storage.getStore();

export const getRequestId = (): string => storage.getStore()?.requestId ?? 'no-request-context';

/**
 * Establishes a correlation id for the request and makes it ambient (SDD 9.2).
 *
 * AsyncLocalStorage rather than passing the id through every signature: logging
 * and error reporting need it at arbitrary depth, and threading it manually
 * would leak a transport concern into the domain.
 */
export const requestContextMiddleware =
  (idGenerator: IdGenerator) =>
  (req: Request, res: Response, next: NextFunction): void => {
    const incoming = req.header('x-request-id');
    const requestId = incoming && incoming.length <= 128 ? incoming : idGenerator.generate();

    res.setHeader('x-request-id', requestId);
    storage.run({ requestId, startedAt: Date.now() }, () => {
      next();
    });
  };
