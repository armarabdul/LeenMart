import { describe, expect, it, vi } from 'vitest';
import { FixedClock, NullLogger } from '@leen-mart/domain-kit';
import { SendPickupRemindersUseCase } from '../../../../../src/modules/order/application/use-cases/send-pickup-reminders.use-case.js';
import { PICKUP_REMINDER_LEAD_MS } from '../../../../../src/modules/order/domain/services/pickup-reminder-policy.js';
import type { PickupReminderCandidate } from '../../../../../src/modules/order/application/ports/pickup-reminder-query.port.js';
import type { PickupReminderCandidateQuery } from '../../../../../src/modules/order/application/ports/pickup-reminder-query.port.js';
import type { PickupReminderOutboxLookup } from '../../../../../src/modules/order/application/ports/pickup-reminder-outbox-lookup.port.js';
import type { OutboxWriter } from '../../../../../src/shared/application/ports/outbox-writer.port.js';

const NOW = new Date('2026-08-20T10:00:00.000Z');
const clock = new FixedClock(NOW);

const candidate = (overrides: Partial<PickupReminderCandidate> = {}): PickupReminderCandidate => ({
  subOrderId: 'sub-order-1',
  orderId: 'order-1',
  vendorId: 'vendor-1',
  customerId: 'customer-1',
  pickupInstant: new Date(NOW.getTime() + PICKUP_REMINDER_LEAD_MS),
  ...overrides,
});

interface Deps {
  readonly pickupReminderQuery: PickupReminderCandidateQuery;
  readonly pickupReminderOutboxLookup: PickupReminderOutboxLookup;
  readonly outboxWriter: OutboxWriter;
}

const buildDeps = (
  candidates: readonly PickupReminderCandidate[],
  alreadyReminded = false,
): Deps & {
  write: ReturnType<typeof vi.fn>;
  exists: ReturnType<typeof vi.fn>;
} => {
  const write = vi.fn().mockResolvedValue(undefined);
  const exists = vi.fn().mockResolvedValue(alreadyReminded);
  const outboxWriter: OutboxWriter = {
    withTransaction: () => outboxWriter,
    write,
  };
  return {
    pickupReminderQuery: { findCandidates: vi.fn().mockResolvedValue(candidates) },
    pickupReminderOutboxLookup: { exists },
    outboxWriter,
    write,
    exists,
  };
};

const useCase = (deps: Deps): SendPickupRemindersUseCase =>
  new SendPickupRemindersUseCase({ ...deps, clock, logger: new NullLogger() });

describe('SendPickupRemindersUseCase (S7-SCHED)', () => {
  it('a due, not-yet-reminded candidate produces exactly one outbox write with the server-resolved recipient', async () => {
    const deps = buildDeps([candidate()]);

    await useCase(deps).run();

    expect(deps.write).toHaveBeenCalledTimes(1);
    expect(deps.write).toHaveBeenCalledWith({
      aggregateType: 'SubOrder',
      aggregateId: 'sub-order-1',
      eventType: 'sub_order.pickup_reminder',
      payload: {
        subOrderId: 'sub-order-1',
        orderId: 'order-1',
        vendorId: 'vendor-1',
        customerId: 'customer-1',
      },
    });
  });

  it('a candidate outside the due window is skipped entirely — no idempotency check, no write', async () => {
    const deps = buildDeps([
      candidate({ pickupInstant: new Date(NOW.getTime() + PICKUP_REMINDER_LEAD_MS + 60_000) }),
    ]);

    await useCase(deps).run();

    expect(deps.exists).not.toHaveBeenCalled();
    expect(deps.write).not.toHaveBeenCalled();
  });

  it('an already-reminded candidate (lookup says it exists) is skipped — no duplicate write', async () => {
    const deps = buildDeps([candidate()], true);

    await useCase(deps).run();

    expect(deps.exists).toHaveBeenCalledWith('sub-order-1');
    expect(deps.write).not.toHaveBeenCalled();
  });

  it('repeated runs are idempotent: the second run finds the event already present and writes nothing more', async () => {
    const deps = buildDeps([candidate()]);

    await useCase(deps).run();
    expect(deps.write).toHaveBeenCalledTimes(1);

    // Simulate the outbox now holding the event this run just wrote.
    deps.exists.mockResolvedValue(true);
    await useCase(deps).run();

    expect(deps.write).toHaveBeenCalledTimes(1);
  });

  it('no candidates at all is a clean no-op', async () => {
    const deps = buildDeps([]);

    await expect(useCase(deps).run()).resolves.toBeUndefined();
    expect(deps.exists).not.toHaveBeenCalled();
    expect(deps.write).not.toHaveBeenCalled();
  });

  it('several candidates are each evaluated independently — due-and-new writes, due-and-reminded does not, not-due never reaches the lookup', async () => {
    const due = candidate({ subOrderId: 'sub-order-due' });
    const dueButReminded = candidate({ subOrderId: 'sub-order-reminded' });
    const notDue = candidate({
      subOrderId: 'sub-order-not-due',
      pickupInstant: new Date(NOW.getTime() + PICKUP_REMINDER_LEAD_MS + 60_000),
    });
    const deps = buildDeps([due, dueButReminded, notDue]);
    deps.exists.mockImplementation((subOrderId: string) =>
      Promise.resolve(subOrderId === 'sub-order-reminded'),
    );

    await useCase(deps).run();

    expect(deps.exists).toHaveBeenCalledTimes(2);
    expect(deps.write).toHaveBeenCalledTimes(1);
    expect(deps.write.mock.calls[0]?.[0]).toMatchObject({ aggregateId: 'sub-order-due' });
  });

  it('queries the sweep window as today and tomorrow in IST, not an arbitrary range', async () => {
    const deps = buildDeps([]);

    await useCase(deps).run();

    expect(deps.pickupReminderQuery.findCandidates).toHaveBeenCalledWith(
      '2026-08-20',
      '2026-08-21',
    );
  });
});
