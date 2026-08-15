import type { Prisma, PrismaClient } from '@prisma/client';
import type { Clock, IdGenerator, TransactionScope } from '@leen-mart/domain-kit';
import type {
  OutboxWriter,
  OutboxWriterInput,
} from '../../application/ports/outbox-writer.port.js';

export class PrismaOutboxWriter implements OutboxWriter {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly idGenerator: IdGenerator,
    private readonly clock: Clock,
  ) {}

  withTransaction(scope: TransactionScope): OutboxWriter {
    return new PrismaOutboxWriter(scope as unknown as PrismaClient, this.idGenerator, this.clock);
  }

  /**
   * `createMany`, not `create` — `create()` always does `INSERT ...
   * RETURNING`, which Postgres treats as a read of the new row and refuses
   * without `SELECT` on the table. `leenmart_checkout`'s grant on
   * `outbox_events` is deliberately `INSERT` only (see the migration's own
   * comment), so `createMany` (no `RETURNING`, `{ count }` only) is what
   * actually keeps this insert-only in practice, not just in intent.
   */
  async write(input: OutboxWriterInput): Promise<void> {
    await this.prisma.outboxEvent.createMany({
      data: [
        {
          id: this.idGenerator.generate(),
          aggregateType: input.aggregateType,
          aggregateId: input.aggregateId,
          eventType: input.eventType,
          payload: input.payload as Prisma.InputJsonValue,
          occurredAt: this.clock.now(),
        },
      ],
    });
  }
}
