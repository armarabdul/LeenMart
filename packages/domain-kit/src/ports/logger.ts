/**
 * Logging port.
 *
 * The domain and application layers depend on this interface, never on Pino.
 * Swapping the logging implementation must not touch a single use case.
 */
export type LogLevel = 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace';

export type LogContext = Record<string, unknown>;

export interface Logger {
  fatal(context: LogContext, message: string): void;
  error(context: LogContext, message: string): void;
  warn(context: LogContext, message: string): void;
  info(context: LogContext, message: string): void;
  debug(context: LogContext, message: string): void;
  trace(context: LogContext, message: string): void;
  /** Returns a logger that stamps every line with the supplied bindings. */
  child(bindings: LogContext): Logger;
}

/** No-op logger for unit tests that do not assert on logging. */
export class NullLogger implements Logger {
  fatal(): void {
    // Intentionally a no-op: tests that don't assert on logging shouldn't need a real sink.
  }

  error(): void {
    // Intentionally a no-op: tests that don't assert on logging shouldn't need a real sink.
  }

  warn(): void {
    // Intentionally a no-op: tests that don't assert on logging shouldn't need a real sink.
  }

  info(): void {
    // Intentionally a no-op: tests that don't assert on logging shouldn't need a real sink.
  }

  debug(): void {
    // Intentionally a no-op: tests that don't assert on logging shouldn't need a real sink.
  }

  trace(): void {
    // Intentionally a no-op: tests that don't assert on logging shouldn't need a real sink.
  }

  child(): Logger {
    return this;
  }
}
