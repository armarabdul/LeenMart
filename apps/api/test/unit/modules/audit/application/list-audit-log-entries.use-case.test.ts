import { describe, expect, it } from 'vitest';
import { toUuid } from '@leen-mart/domain-kit';
import { ListAuditLogEntriesUseCase } from '../../../../../src/modules/audit/application/use-cases/list-audit-log-entries.use-case.js';
import type { AuditLogEntry } from '../../../../../src/modules/audit/domain/entities/audit-log-entry.entity.js';
import type {
  AuditLogEntryPage,
  AuditLogRepository,
  ListAuditLogEntriesFilter,
} from '../../../../../src/modules/audit/domain/repositories/audit-log.repository.js';
import { toUserId } from '../../../../../src/modules/identity/domain/value-objects/user-id.value-object.js';

/** Records exactly what it was called with, so the use case's passthrough — not any pagination logic of its own — is what these tests verify. */
class RecordingAuditLogRepository implements AuditLogRepository {
  lastFilter: ListAuditLogEntriesFilter | null = null;

  constructor(private readonly page: AuditLogEntryPage) {}

  withTransaction(): AuditLogRepository {
    throw new Error('not used by this use case');
  }

  append(): Promise<void> {
    throw new Error('not used by this use case');
  }

  findByActor(): Promise<readonly AuditLogEntry[]> {
    throw new Error('not used by this use case');
  }

  findByEntity(): Promise<readonly AuditLogEntry[]> {
    throw new Error('not used by this use case');
  }

  listPage(filter: ListAuditLogEntriesFilter): Promise<AuditLogEntryPage> {
    this.lastFilter = filter;
    return Promise.resolve(this.page);
  }
}

const EMPTY_PAGE: AuditLogEntryPage = { items: [], nextCursor: null, hasMore: false };

describe('ListAuditLogEntriesUseCase', () => {
  it('passes limit and cursor straight through to the repository', async () => {
    const repository = new RecordingAuditLogRepository(EMPTY_PAGE);
    const useCase = new ListAuditLogEntriesUseCase({ auditLogRepository: repository });

    await useCase.execute({ limit: 20, cursor: '2026-01-01T00:00:00.000Z|some-id' });

    expect(repository.lastFilter).toEqual({
      limit: 20,
      cursor: '2026-01-01T00:00:00.000Z|some-id',
    });
  });

  it('passes every filter (actorId, entityType, entityId, action) straight through', async () => {
    const repository = new RecordingAuditLogRepository(EMPTY_PAGE);
    const useCase = new ListAuditLogEntriesUseCase({ auditLogRepository: repository });
    const actorId = toUserId('00000000-0000-7000-8000-000000000a01');
    const entityId = toUuid('00000000-0000-7000-8000-000000000a02');

    await useCase.execute({
      limit: 10,
      actorId,
      entityType: 'category',
      entityId,
      action: 'catalogue.category.created',
    });

    expect(repository.lastFilter).toEqual({
      limit: 10,
      actorId,
      entityType: 'category',
      entityId,
      action: 'catalogue.category.created',
    });
  });

  it('returns exactly what the repository returns, unmodified', async () => {
    const page: AuditLogEntryPage = {
      items: [{ id: 'entry-1' } as unknown as AuditLogEntry],
      nextCursor: '2026-01-01T00:00:00.000Z|entry-1',
      hasMore: true,
    };
    const repository = new RecordingAuditLogRepository(page);
    const useCase = new ListAuditLogEntriesUseCase({ auditLogRepository: repository });

    const result = await useCase.execute({ limit: 1 });

    expect(result).toBe(page);
  });
});
