import { useEffect, useState } from 'react';
import type { AdminUser } from '@leen-mart/contracts';
import { QueueStateView } from '@/components/QueueStateView';
import { useListAdminUsersQuery } from '@/features/admin-user-management/admin-user-management.api';
import { AdminUserList } from '@/features/admin-user-management/components/AdminUserList';
import { CreateAdminUserForm } from '@/features/admin-user-management/components/CreateAdminUserForm';

/**
 * `GET`/`POST /admin/users` (Phase L.2 backend, Phase L.5 frontend) — the
 * SUPER_ADMIN-gated roster of subordinate administrator accounts. No
 * deactivate/reactivate/role-change action exists here: L.2's backend scope
 * was create+list only, and inventing a mutation the API doesn't support
 * would be scope this phase explicitly excludes.
 *
 * The nav link and this page are visible to every authenticated admin, the
 * same way every other screen in this app is — the backend's
 * `MANAGE_ADMIN_USERS_OR_ROLES` permission (`FULL` for SUPER_ADMIN only, no
 * `READ_ONLY` grant for anyone else) is the only authority over who may
 * actually list or create here; a non-SUPER_ADMIN caller gets the real
 * backend 403, never a locally hidden button.
 */
export const AdminUsersPage = (): JSX.Element => {
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [items, setItems] = useState<readonly AdminUser[]>([]);

  const { data, isLoading, isFetching, isError, error, refetch } = useListAdminUsersQuery({
    limit: 20,
    cursor,
  });

  useEffect(() => {
    if (!data) return;
    setItems((current) => (cursor ? [...current, ...data.items] : data.items));
  }, [data, cursor]);

  const isInitialLoad = isLoading && items.length === 0;

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-8">
      <div>
        <h1 className="text-xl font-bold tracking-tight text-slate-900">Admin Users</h1>
        <p className="text-sm text-slate-600">
          Create and review subordinate administrator accounts — Catalogue Moderator, Finance Admin,
          Risk Analyst and Support Agent. A new account starts with no MFA secret; the administrator
          enrolls on their own first sign-in.
        </p>
      </div>

      <CreateAdminUserForm onCreated={() => void refetch()} />

      <QueueStateView
        isInitialLoad={isInitialLoad}
        skeletonLabel="Loading admin users"
        isError={isError}
        error={error}
        errorFallback="Admin users could not be loaded."
        onRetry={() => void refetch()}
        isEmpty={items.length === 0}
        emptyTitle="No admin users yet"
        emptyDescription="Create the first subordinate administrator above."
        hasMore={Boolean(data?.hasMore)}
        isFetchingMore={isFetching && !isInitialLoad}
        onLoadMore={() => setCursor(data?.nextCursor ?? undefined)}
      >
        <AdminUserList items={items} />
      </QueueStateView>
    </main>
  );
};
