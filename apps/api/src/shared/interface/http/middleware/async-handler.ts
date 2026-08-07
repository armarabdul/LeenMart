import type { NextFunction, Request, RequestHandler, Response } from 'express';

/**
 * Express 5 forwards rejected promises to the error middleware natively, so
 * this wrapper exists only to give handlers a precise return type and to keep
 * the intent explicit at call sites.
 */
export const asyncHandler =
  (handler: (req: Request, res: Response, next: NextFunction) => Promise<void>): RequestHandler =>
  (req, res, next) => {
    handler(req, res, next).catch(next);
  };
