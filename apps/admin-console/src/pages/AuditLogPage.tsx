import { useEffect, useState } from 'react';
import type { AuditLogEntryDto, ListAuditLogEntriesQuery } from '@leen-mart/contracts';
import { QueueStateView } from '@/components/QueueStateView';
import { useListAuditLogQuery } from '@/features/audit-log/audit-log.api';
import { AuditLogFilterBar } from '@/features/audit-log/components/AuditLogFilterBar';
import { AuditLogRow } from '@/features/audit-log/components/AuditLogRow';
import {
  EMPTY_AUDIT_LOG_FILTERS,
  type AuditLogFilters,
} from '@/features/audit-log/lib/audit-log-filters';

/** Blank text fields become an absent filter, not an empty-string one — the backend's `.optional()` schema, not `''`, is what "not filtering by this" means on the wire. */
const toQuery = (
  filters: AuditLogFilters,
  cursor: string | undefined,
): ListAuditLogEntriesQuery => ({
  limit: 20,
  cursor,
  actorId: filters.actorId.trim() || undefined,
  entityType: filters.entityType.trim() || undefined,
  entityId: filters.entityId.trim() || undefined,
  action: filters.action.trim() || undefined,
});

/** `GET /admin/audit-logs` (Phase L.3) — the platform-wide audit trail, read-only. */
export const AuditLogPage = (): JSX.Element => {
  const [filters, setFilters] = useState<AuditLogFilters>(EMPTY_AUDIT_LOG_FILTERS);
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [items, setItems] = useState<readonly AuditLogEntryDto[]>([]);

  const { data, isLoading, isFetching, isError, error, refetch } = useListAuditLogQuery(
    toQuery(filters, cursor),
  );

  // Filters changing resets the accumulated list and the cursor; a page
  // arriving for the *current* filter set appends to it — the same
  // "load more" shape `KycQueuePage` uses.
  useEffect(() => {
    setItems([]);
    setCursor(undefined);
  }, [filters]);

  useEffect(() => {
    if (!data) return;
    setItems((current) => (cursor ? [...current, ...data.items] : data.items));
  }, [data, cursor]);

  const isInitialLoad = isLoading && items.length === 0;

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 py-8">
      <div>
        <h1 className="text-xl font-bold tracking-tight text-slate-900">Audit Log</h1>
        <p className="text-sm text-slate-600">Every administrative action across the platform.</p>
      </div>

      <AuditLogFilterBar filters={filters} onApply={setFilters} />

      <QueueStateView
        isInitialLoad={isInitialLoad}
        skeletonLabel="Loading audit log"
        isError={isError}
        error={error}
        errorFallback="The audit log could not be loaded."
        onRetry={() => void refetch()}
        isEmpty={items.length === 0}
        emptyTitle="No matching entries"
        emptyDescription="Nothing matches the selected filters right now."
        hasMore={Boolean(data?.hasMore)}
        isFetchingMore={isFetching && !isInitialLoad}
        onLoadMore={() => setCursor(data?.nextCursor ?? undefined)}
      >
        <ul className="flex flex-col gap-3">
          {items.map((entry) => (
            <AuditLogRow key={entry.id} entry={entry} />
          ))}
        </ul>
      </QueueStateView>
    </main>
  );
};
