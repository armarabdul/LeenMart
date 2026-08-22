import { useState, type FormEvent } from 'react';
import { Button, Input } from '@leen-mart/ui';
import { EMPTY_AUDIT_LOG_FILTERS, type AuditLogFilters } from '../lib/audit-log-filters.js';

interface AuditLogFilterBarProps {
  readonly filters: AuditLogFilters;
  readonly onApply: (filters: AuditLogFilters) => void;
}

/**
 * Draft state kept separate from the applied filters — every keystroke would
 * otherwise refetch. Split out of `AuditLogPage` purely to keep it within
 * this repository's function-length budget, the same reason
 * `KycStatusFilter` was.
 */
export const AuditLogFilterBar = ({ filters, onApply }: AuditLogFilterBarProps): JSX.Element => {
  const [draft, setDraft] = useState<AuditLogFilters>(filters);

  const handleSubmit = (event: FormEvent): void => {
    event.preventDefault();
    onApply(draft);
  };

  const handleClear = (): void => {
    setDraft(EMPTY_AUDIT_LOG_FILTERS);
    onApply(EMPTY_AUDIT_LOG_FILTERS);
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="grid grid-cols-1 items-end gap-3 sm:grid-cols-2 lg:grid-cols-5"
    >
      <Input
        label="Actor ID"
        placeholder="uuid"
        value={draft.actorId}
        onChange={(event) => setDraft({ ...draft, actorId: event.target.value })}
      />
      <Input
        label="Entity type"
        placeholder="e.g. category"
        value={draft.entityType}
        onChange={(event) => setDraft({ ...draft, entityType: event.target.value })}
      />
      <Input
        label="Entity ID"
        placeholder="uuid"
        value={draft.entityId}
        onChange={(event) => setDraft({ ...draft, entityId: event.target.value })}
      />
      <Input
        label="Action"
        placeholder="e.g. catalogue.category.created"
        value={draft.action}
        onChange={(event) => setDraft({ ...draft, action: event.target.value })}
      />
      <div className="flex gap-2">
        <Button type="submit">Apply</Button>
        <Button type="button" variant="secondary" onClick={handleClear}>
          Clear
        </Button>
      </div>
    </form>
  );
};
