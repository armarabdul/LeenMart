import { AsyncLocalStorage } from 'node:async_hooks';
import type { NextFunction, Request, Response } from 'express';
import type { IdGenerator } from '@leen-mart/domain-kit';

export interface RequestContext {
  readonly requestId: string;
  /**
   * The caller's IP, as Express resolved it under the configured `trust proxy`
   * hop count (SDD 18.4's `ip`). Nullable because a caller may have none:
   * `AuditLogRequestContext` already models all three of these as nullable for
   * exactly that reason — an action taken by a scheduled job or a CLI has no
   * request behind it.
   */
  readonly ip: string | null;
  /** SDD 18.4's `userAgent`. Null when the client sent no `User-Agent` header. */
  readonly userAgent: string | null;
  readonly startedAt: number;
}

/**
 * Upper bound on the stored `User-Agent`, mirroring the 128-character guard
 * `requestId` already applies to its own inbound header.
 *
 * Unlike `ip`, this value is entirely client-controlled, and Node's default
 * 16 KB header allowance means an unbounded one could carry kilobytes into
 * every ambient context and, once an audit writer exists, into every row of a
 * table retained for eight years. Real user agents run to a couple of hundred
 * characters, so this truncates only input that was never a genuine one.
 */
const MAX_USER_AGENT_LENGTH = 512;

const storage = new AsyncLocalStorage<RequestContext>();

/** Returns the ambient request context, if the caller is inside a request. */
export const getRequestContext = (): RequestContext | undefined => storage.getStore();

export const getRequestId = (): string => storage.getStore()?.requestId ?? 'no-request-context';

/**
 * Establishes a correlation id for the request and makes it ambient (SDD 9.2),
 * along with the caller's IP and user agent (SDD 18.4).
 *
 * AsyncLocalStorage rather than passing the id through every signature: logging
 * and error reporting need it at arbitrary depth, and threading it manually
 * would leak a transport concern into the domain. The same reasoning extends to
 * `ip` and `userAgent`: SDD 18.4 requires both on every audit entry, and an
 * audit record is written from the application layer, which has no `Request`.
 *
 * `req.ip` — never the `X-Forwarded-For` header directly. `app.ts` sets
 * `trust proxy` to a hop *count* rather than `true`, precisely so a client
 * cannot spoof its own address; reading the header here would step around that
 * and reintroduce the spoofing this codebase already decided against.
 */
export const requestContextMiddleware =
  (idGenerator: IdGenerator) =>
  (req: Request, res: Response, next: NextFunction): void => {
    const incoming = req.header('x-request-id');
    const requestId = incoming && incoming.length <= 128 ? incoming : idGenerator.generate();

    const userAgent = req.header('user-agent');

    res.setHeader('x-request-id', requestId);
    storage.run(
      {
        requestId,
        ip: req.ip ?? null,
        userAgent: userAgent ? userAgent.slice(0, MAX_USER_AGENT_LENGTH) : null,
        startedAt: Date.now(),
      },
      () => {
        next();
      },
    );
  };
