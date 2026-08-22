export interface AuditLogFilters {
  readonly actorId: string;
  readonly entityType: string;
  readonly entityId: string;
  readonly action: string;
}

export const EMPTY_AUDIT_LOG_FILTERS: AuditLogFilters = {
  actorId: '',
  entityType: '',
  entityId: '',
  action: '',
};
