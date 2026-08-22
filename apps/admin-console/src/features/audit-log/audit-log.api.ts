import type { AuditLogEntryDto, ListAuditLogEntriesQuery } from '@leen-mart/contracts';
import { baseApi } from '@/shared/api/base-api';

/**
 * The admin audit-log read surface (Phase L.3). Every route/contract here is
 * consumed exactly as the backend already defines it —
 * `packages/contracts/src/audit/audit.contract.ts` — nothing invented.
 */

/** List endpoints return `{ data, meta: { requestId, pagination } }`, not the plain `SuccessEnvelope` shape (`admin-audit-log.controller.ts`'s own `list` handler). */
interface PaginatedResponse<TItem> {
  readonly data: readonly TItem[];
  readonly meta: {
    readonly requestId: string;
    readonly pagination: { readonly nextCursor: string | null; readonly hasMore: boolean };
  };
}

export interface AuditLogPage {
  readonly items: readonly AuditLogEntryDto[];
  readonly nextCursor: string | null;
  readonly hasMore: boolean;
}

/** Built by hand rather than via `params`, matching `kycQueueUrl`'s own reasoning — every field here is a plain scalar, so this is just the URLSearchParams shape made explicit. */
const auditLogUrl = (query: ListAuditLogEntriesQuery): string => {
  const params = new URLSearchParams();
  params.set('limit', String(query.limit));
  if (query.cursor) params.set('cursor', query.cursor);
  if (query.actorId) params.set('actorId', query.actorId);
  if (query.entityType) params.set('entityType', query.entityType);
  if (query.entityId) params.set('entityId', query.entityId);
  if (query.action) params.set('action', query.action);
  const search = params.toString();
  return search ? `/admin/audit-logs?${search}` : '/admin/audit-logs';
};

export const auditLogApi = baseApi.injectEndpoints({
  endpoints: (builder) => ({
    listAuditLog: builder.query<AuditLogPage, ListAuditLogEntriesQuery>({
      query: auditLogUrl,
      transformResponse: (response: PaginatedResponse<AuditLogEntryDto>) => ({
        items: response.data,
        nextCursor: response.meta.pagination.nextCursor,
        hasMore: response.meta.pagination.hasMore,
      }),
      providesTags: (result) =>
        result
          ? [
              ...result.items.map((item) => ({ type: 'AuditLog' as const, id: item.id })),
              { type: 'AuditLog' as const, id: 'LIST' },
            ]
          : [{ type: 'AuditLog' as const, id: 'LIST' }],
    }),
  }),
});

export const { useListAuditLogQuery } = auditLogApi;
