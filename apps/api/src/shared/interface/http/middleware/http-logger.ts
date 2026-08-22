import type { IncomingMessage, ServerResponse } from 'node:http';
import { pinoHttp, type HttpLogger } from 'pino-http';
import type { Logger as PinoLogger } from 'pino';
import { getRequestId } from './request-context.js';

/**
 * One structured log line per request (SDD 18.1).
 *
 * Level is derived from the outcome: 4xx is `warn` because it is usually a
 * client bug worth noticing, 401/403 included since a burst of them is a signal
 * rather than noise; 5xx is `error`.
 */
export const createHttpLogger = (logger: PinoLogger): HttpLogger =>
  pinoHttp({
    logger,
    genReqId: () => getRequestId(),
    quietReqLogger: true,
    autoLogging: {
      ignore: (req) => req.url === '/healthz' || req.url === '/readyz',
    },
    customLogLevel: (_req, res, error) => {
      if (error) return 'error';
      if (res.statusCode >= 500) return 'error';
      if (res.statusCode >= 400) return 'warn';
      return 'info';
    },
    customSuccessMessage: (req, res) =>
      `${req.method ?? 'UNKNOWN'} ${req.url ?? ''} ${res.statusCode}`,
    customErrorMessage: (req, res, error) =>
      `${req.method ?? 'UNKNOWN'} ${req.url ?? ''} ${res.statusCode} — ${error.message}`,
    serializers: {
      // Never log the full body, query string or headers: PII lands there
      // and the redaction allowlist only covers what it knows about (SDD 18.2).
      // Pino's own `serializers` option type is untyped (`any`-based) for
      // generality, so the request/response shapes are annotated explicitly
      // here — pino-http augments `IncomingMessage` with `.id` (see its
      // `declare module 'http'`), and `.method`/`.url`/`.statusCode` are
      // native Node HTTP properties.
      req: (req: IncomingMessage) => ({ id: req.id, method: req.method, url: req.url }),
      res: (res: ServerResponse) => ({ statusCode: res.statusCode }),
    },
  });
