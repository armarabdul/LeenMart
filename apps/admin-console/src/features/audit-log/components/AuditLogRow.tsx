import { Card } from '@leen-mart/ui';
import type { AuditLogEntryDto } from '@leen-mart/contracts';

const formatDateTime = (iso: string): string =>
  new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });

/** Pretty-printed, structural JSON — never flattened, never given fields the backend didn't send. `null` (no snapshot captured) renders as a dash rather than the literal text `null`. */
const SnapshotJson = ({
  label,
  value,
}: {
  readonly label: string;
  readonly value: unknown;
}): JSX.Element => (
  <div className="min-w-0">
    <p className="text-xs font-medium text-text-muted">{label}</p>
    {value === null ? (
      <p className="mt-1 text-xs text-text-faint">—</p>
    ) : (
      <pre className="mt-1 max-h-40 overflow-auto rounded-md bg-surface-alt p-2 text-xs text-text">
        {JSON.stringify(value, null, 2)}
      </pre>
    )}
  </div>
);

export const AuditLogRow = ({ entry }: { readonly entry: AuditLogEntryDto }): JSX.Element => (
  <li>
    <Card className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-text">{entry.action}</p>
          <p className="truncate text-xs text-text-muted">
            {entry.entityType}
            {entry.entityId ? ` · ${entry.entityId}` : ''}
          </p>
        </div>
        <p className="shrink-0 text-xs text-text-faint">{formatDateTime(entry.createdAt)}</p>
      </div>
      <p className="text-xs text-text-muted">
        Actor {entry.actorId ?? 'system'} ({entry.actorRole})
        {entry.impersonatedBy ? ` · impersonated by ${entry.impersonatedBy}` : ''}
      </p>
      {entry.reason && <p className="text-xs text-text-muted">Reason: {entry.reason}</p>}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <SnapshotJson label="Before" value={entry.before} />
        <SnapshotJson label="After" value={entry.after} />
      </div>
    </Card>
  </li>
);
