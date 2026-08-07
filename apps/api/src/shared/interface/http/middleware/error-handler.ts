import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { type Clock, type ErrorDetail, type ErrorKind, isAppError, RateLimitError } from '@leen-mart/domain-kit';
import type { Logger as PinoLogger } from 'pino';
import { getRequestId } from './request-context.js';

/**
 * The single mapping from a domain error to an HTTP status (SDD 17.1).
 *
 * `satisfies Record<ErrorKind, number>` makes the map exhaustive: adding a new
 * error kind without deciding its status code is a compile error.
 */
const STATUS_BY_KIND = {
  VALIDATION: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  DOMAIN_RULE: 422,
  RATE_LIMIT: 429,
  INTEGRATION: 502,
  INTERNAL: 500,
} as const satisfies Record<ErrorKind, number>;

interface ErrorBody {
  error: {
    code: string;
    message: string;
    details?: ErrorDetail[];
    requestId: string;
    timestamp: string;
  };
}

const zodToDetails = (error: ZodError): ErrorDetail[] =>
  error.issues.map((issue) => {
    const field = issue.path.join('.');
    return { ...(field ? { field } : {}), issue: issue.message };
  });

interface BuildBodyInput {
  readonly code: string;
  readonly message: string;
  readonly details: ErrorDetail[] | undefined;
  readonly requestId: string;
  readonly now: Date;
}

const buildBody = ({ code, message, details, requestId, now }: BuildBodyInput): ErrorBody => ({
  error: {
    code,
    message,
    ...(details && details.length > 0 ? { details } : {}),
    requestId,
    timestamp: now.toISOString(),
  },
});

/**
 * Global error handler. Controllers never translate errors themselves.
 *
 * Two rules are enforced here, and both are security properties rather than
 * conveniences: nothing internal (stack trace, SQL, provider payload) ever
 * reaches the client, and every response carries the request id so the detail
 * is one log query away.
 */
export const createErrorHandler =
  (logger: PinoLogger, clock: Clock) =>
  (error: unknown, _req: Request, res: Response, next: NextFunction): void => {
    if (res.headersSent) {
      next(error);
      return;
    }

    const requestId = getRequestId();
    const now = clock.now();

    if (error instanceof ZodError) {
      const details = zodToDetails(error);
      logger.info({ requestId, details }, 'Request failed validation');
      res
        .status(STATUS_BY_KIND.VALIDATION)
        .json(
          buildBody({
            code: 'VALIDATION_FAILED',
            message: 'The request payload failed validation.',
            details,
            requestId,
            now,
          }),
        );
      return;
    }

    if (isAppError(error)) {
      const status = STATUS_BY_KIND[error.kind];
      const details = [...error.details];

      if (error instanceof RateLimitError) {
        res.setHeader('Retry-After', String(error.retryAfterSeconds));
      }

      // 5xx is our fault and needs a stack; 4xx is expected traffic.
      if (status >= 500) {
        logger.error({ requestId, err: error, code: error.code }, error.message);
      } else if (error.kind === 'FORBIDDEN' || error.kind === 'UNAUTHENTICATED') {
        logger.warn({ requestId, code: error.code }, error.message);
      } else {
        logger.info({ requestId, code: error.code }, error.message);
      }

      res.status(status).json(buildBody({ code: error.code, message: error.message, details, requestId, now }));
      return;
    }

    // Anything reaching here is a bug. Log everything, disclose nothing.
    logger.error({ requestId, err: error }, 'Unhandled error');
    res
      .status(STATUS_BY_KIND.INTERNAL)
      .json(
        buildBody({
          code: 'INTERNAL_ERROR',
          message: 'An unexpected error occurred. Quote the request id if you contact support.',
          details: undefined,
          requestId,
          now,
        }),
      );
  };

/** Terminal 404 handler for unmatched routes. */
export const createNotFoundHandler =
  (clock: Clock) =>
  (req: Request, res: Response): void => {
    res.status(404).json(
      buildBody({
        code: 'ROUTE_NOT_FOUND',
        message: `Cannot ${req.method} ${req.path}`,
        details: undefined,
        requestId: getRequestId(),
        now: clock.now(),
      }),
    );
  };

export { STATUS_BY_KIND };
