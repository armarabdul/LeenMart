import type { AdminUser } from '@leen-mart/contracts';
import { StatusBadge } from '@leen-mart/ui';
import { ADMIN_USER_STATUS_TONE } from '../lib/admin-user-status-tone';

interface AdminUserListProps {
  readonly items: readonly AdminUser[];
}

/**
 * The subordinate-admin roster (Phase L.5). Read-only — no row here links
 * anywhere or offers an action; deactivate/reactivate/role-change do not
 * exist on the backend yet (L.2's own scope was create+list only) and are
 * explicitly out of this phase.
 *
 * Renders exactly the fields `adminUserSchema` publishes — email, role,
 * status, timestamps, id. The schema itself never carries a password hash or
 * MFA state (`.strict()`, mapped field-by-field on the backend), so there is
 * nothing here that could leak either even by accident.
 */
export const AdminUserList = ({ items }: AdminUserListProps): JSX.Element => (
  <ul className="flex flex-col gap-2">
    {items.map((admin) => (
      <li
        key={admin.id}
        className="flex flex-col gap-2 rounded-card border border-border bg-surface p-3 sm:flex-row sm:items-center sm:justify-between"
      >
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-text">{admin.email}</p>
          <p className="truncate text-xs text-text-muted">
            {admin.role} · created {new Date(admin.createdAt).toLocaleDateString()}
          </p>
        </div>
        <StatusBadge tone={ADMIN_USER_STATUS_TONE[admin.status]} label={admin.status} />
      </li>
    ))}
  </ul>
);
