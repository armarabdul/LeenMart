import { pino, type Logger as PinoLogger } from 'pino';
import type { LogContext, Logger } from '@leen-mart/domain-kit';
import type { Env } from '../../config/env.js';

/**
 * Structured JSON logging (SDD 18).
 *
 * Redaction is an allowlist of paths rather than a denylist, because a denylist
 * is guaranteed to miss the field someone adds next month. Request and response
 * bodies are never logged wholesale.
 */
export const REDACTED_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-api-key"]',
  'req.headers["x-razorpay-signature"]',
  'res.headers["set-cookie"]',
  'password',
  'passwordHash',
  '*.password',
  'otp',
  '*.otp',
  'token',
  '*.token',
  'accessToken',
  'refreshToken',
  'aadhaar',
  '*.aadhaar',
  'pan',
  '*.pan',
  'bankAccountNumber',
  '*.bankAccountNumber',
  'cardNumber',
  '*.cardNumber',
  'cvv',
  'signature',
] as const;

export const createRootLogger = (env: Env): PinoLogger =>
  pino({
    level: env.LOG_LEVEL,
    base: {
      service: env.SERVICE_NAME,
      env: env.NODE_ENV,
      version: env.APP_VERSION,
    },
    timestamp: pino.stdTimeFunctions.isoTime,
    redact: { paths: [...REDACTED_PATHS], censor: '[REDACTED]' },
    formatters: {
      level: (label) => ({ level: label }),
    },
    ...(env.LOG_PRETTY
      ? {
          transport: {
            target: 'pino-pretty',
            options: { colorize: true, translateTime: 'SYS:HH:MM:ss.l', ignore: 'pid,hostname' },
          },
        }
      : {}),
  });

/**
 * Adapts Pino to the framework-free `Logger` port so application and domain
 * code never imports Pino directly (SDD 2.3).
 */
export class PinoLoggerAdapter implements Logger {
  constructor(private readonly pinoLogger: PinoLogger) {}

  fatal(context: LogContext, message: string): void {
    this.pinoLogger.fatal(context, message);
  }

  error(context: LogContext, message: string): void {
    this.pinoLogger.error(context, message);
  }

  warn(context: LogContext, message: string): void {
    this.pinoLogger.warn(context, message);
  }

  info(context: LogContext, message: string): void {
    this.pinoLogger.info(context, message);
  }

  debug(context: LogContext, message: string): void {
    this.pinoLogger.debug(context, message);
  }

  trace(context: LogContext, message: string): void {
    this.pinoLogger.trace(context, message);
  }

  child(bindings: LogContext): Logger {
    return new PinoLoggerAdapter(this.pinoLogger.child(bindings));
  }
}
