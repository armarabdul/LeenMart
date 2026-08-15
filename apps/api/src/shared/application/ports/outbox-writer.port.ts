import type { TransactionScope } from '@leen-mart/domain-kit';

export interface OutboxWriterInput {
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly eventType: string;
  readonly payload: Record<string, unknown>;
}

/**
 * The write half of the transactional outbox (SDD 4.2/ADR-011). Platform
 * infrastructure, not owned by any one module — `OutboxEvent` has existed
 * in `schema.prisma` since the platform foundation, but nothing wrote to it
 * until S3-3A's `PlaceOrderUseCase` became the first genuine producer.
 *
 * No relay/consumer accompanies this (S3-3A's own approved scope: writing
 * the row is in scope, a worker that reads it is not — there is no
 * notification or invoicing module yet for one to dispatch to). This is a
 * pure, local, transactional INSERT: it needs nothing to ever consume the
 * row for the transaction itself to be correct, which is the entire point
 * of the pattern.
 */
export interface OutboxWriter {
  /** Re-binds this writer to a transaction the caller already opened, so the event commits with the write it describes. */
  withTransaction(scope: TransactionScope): OutboxWriter;

  write(input: OutboxWriterInput): Promise<void>;
}
