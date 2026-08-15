import type { PrismaClient, Prisma } from '@prisma/client';

/**
 * The stored outcome of a request already claimed under a given key —
 * present when a caller replays a key that already reached a terminal
 * state (SDD 17.1: "Idempotency replay — 200 with the original response").
 */
export interface IdempotencyRecord {
  readonly status: 'IN_PROGRESS' | 'COMPLETED';
  readonly requestHash: string;
  readonly expiresAt: Date;
  readonly responseStatus: number | null;
  readonly responseBody: unknown;
}

export interface IdempotencyClaimInput {
  readonly id: string;
  readonly userId: string;
  readonly key: string;
  readonly endpoint: string;
  readonly requestHash: string;
  readonly now: Date;
  readonly ttlMs: number;
}

export interface IdempotencyCompleteInput {
  readonly userId: string;
  readonly key: string;
  readonly endpoint: string;
  readonly responseStatus: number;
  readonly responseBody: unknown;
}

export interface IdempotencyReleaseInput {
  readonly userId: string;
  readonly key: string;
  readonly endpoint: string;
}

/** Prisma raises this code for a violated unique constraint. */
const UNIQUE_CONSTRAINT_VIOLATION = 'P2002';

const isUniqueConstraintError = (error: unknown): error is Prisma.PrismaClientKnownRequestError =>
  typeof error === 'object' &&
  error !== null &&
  'code' in error &&
  (error as { code?: unknown }).code === UNIQUE_CONSTRAINT_VIOLATION;

/**
 * `idempotency_keys` (S3-3A). Scoped to `(userId, key, endpoint)` — SDD
 * 6.4's own indexing note, narrowed by `userId` (see the migration's own
 * comment for why). Bound to `checkoutPrisma`: the only consumer today is
 * order placement, and `leenmart_checkout` already carries the grant this
 * table needs.
 */
export class IdempotencyKeyRepository {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Atomically claims `(userId, key, endpoint)`, or returns the record
   * already there. The uniqueness constraint is the arbiter — never a
   * read-then-write existence check, which two concurrent claims would both
   * pass.
   *
   * An expired prior claim (past its 24-hour honour window) is treated as
   * though it never existed: it is deleted and the claim retried once, so
   * the same key genuinely starts over rather than replaying a year-old
   * response forever.
   */
  async claim(input: IdempotencyClaimInput): Promise<'claimed' | IdempotencyRecord> {
    const expiresAt = new Date(input.now.getTime() + input.ttlMs);

    try {
      await this.prisma.idempotencyKey.create({
        data: {
          id: input.id,
          userId: input.userId,
          key: input.key,
          endpoint: input.endpoint,
          requestHash: input.requestHash,
          status: 'IN_PROGRESS',
          expiresAt,
        },
      });
      return 'claimed';
    } catch (error) {
      if (!isUniqueConstraintError(error)) {
        throw error;
      }
    }

    const existing = await this.findExisting(input.userId, input.key, input.endpoint);
    if (!existing) {
      // The row that caused the conflict is already gone (e.g. a
      // concurrent completion cleaned it up between our failed INSERT and
      // this read). Treat as a fresh key: one retry, no loop — a second
      // genuine race here is vanishingly unlikely and, if it happens, the
      // caller's own retry (the client already retries on network errors)
      // resolves it.
      await this.prisma.idempotencyKey.create({
        data: {
          id: input.id,
          userId: input.userId,
          key: input.key,
          endpoint: input.endpoint,
          requestHash: input.requestHash,
          status: 'IN_PROGRESS',
          expiresAt,
        },
      });
      return 'claimed';
    }

    if (existing.expiresAt.getTime() <= input.now.getTime()) {
      await this.prisma.idempotencyKey.deleteMany({
        where: { userId: input.userId, key: input.key, endpoint: input.endpoint },
      });
      await this.prisma.idempotencyKey.create({
        data: {
          id: input.id,
          userId: input.userId,
          key: input.key,
          endpoint: input.endpoint,
          requestHash: input.requestHash,
          status: 'IN_PROGRESS',
          expiresAt,
        },
      });
      return 'claimed';
    }

    return {
      status: existing.status,
      requestHash: existing.requestHash,
      expiresAt: existing.expiresAt,
      responseStatus: existing.responseStatus,
      responseBody: existing.responseBody,
    };
  }

  /** Marks a claimed key COMPLETED with the response to replay on a future reuse. */
  async complete(input: IdempotencyCompleteInput): Promise<void> {
    await this.prisma.idempotencyKey.updateMany({
      where: { userId: input.userId, key: input.key, endpoint: input.endpoint },
      data: {
        status: 'COMPLETED',
        responseStatus: input.responseStatus,
        responseBody: input.responseBody as Prisma.InputJsonValue,
      },
    });
  }

  /**
   * Removes a claim that did not reach a cacheable success — only a 2xx
   * response is worth replaying (SDD 17.1 only ever describes replaying a
   * success). Deleting rather than leaving it IN_PROGRESS is what lets the
   * same key be retried after a genuine failure (insufficient stock, a
   * validation error) instead of being permanently wedged behind its own
   * first, failed attempt.
   */
  async release(input: IdempotencyReleaseInput): Promise<void> {
    await this.prisma.idempotencyKey.deleteMany({
      where: { userId: input.userId, key: input.key, endpoint: input.endpoint },
    });
  }

  private async findExisting(
    userId: string,
    key: string,
    endpoint: string,
  ): Promise<{
    status: 'IN_PROGRESS' | 'COMPLETED';
    requestHash: string;
    expiresAt: Date;
    responseStatus: number | null;
    responseBody: unknown;
  } | null> {
    return this.prisma.idempotencyKey.findUnique({
      where: { userId_key_endpoint: { userId, key, endpoint } },
      select: {
        status: true,
        requestHash: true,
        expiresAt: true,
        responseStatus: true,
        responseBody: true,
      },
    });
  }
}
