import type { TransactionScope, Uuid } from '@leen-mart/domain-kit';
import type { UserId } from '../../../identity/index.js';
import type { AuditLogEntry } from '../entities/audit-log-entry.entity.js';

/**
 * Append-only by construction (SDD 18.4).
 *
 * There is no `update` and no `delete`, and their absence is the point: every
 * other repository in this codebase publishes an `update` because its
 * aggregate has a lifecycle, and this one must not. The database enforces the
 * same rule with a trigger, so a caller that reaches for a mutation finds the
 * door locked at both the type level and the storage level.
 *
 * The two finders exist to match the two indexes the table already carries —
 * `idx_audit_actor` on `(actor_id, created_at)` and `idx_audit_entity` on
 * `(entity_type, entity_id, created_at)`. They answer the two questions SDD
 * 18.4's "queryable by admins" implies: what did this person do, and what
 * happened to this thing.
 */
/** One page of the general audit browse (Phase L.3) — the platform's existing cursor convention (SDD 9.2), same shape `AdminUserPage`/`NotificationPage` publish. */
export interface AuditLogEntryPage {
  readonly items: readonly AuditLogEntry[];
  readonly nextCursor: string | null;
  readonly hasMore: boolean;
}

/**
 * Filters for `listPage`, all optional and composable. `actorId` and
 * `entityType`/`entityId` deliberately overlap what `findByActor`/
 * `findByEntity` already answer — this method exists for the queries neither
 * of those two narrow finders can express: unfiltered browse, filtering by
 * `action` alone, or combining filters together.
 */
export interface ListAuditLogEntriesFilter {
  readonly limit: number;
  readonly cursor?: string | undefined;
  readonly actorId?: UserId | undefined;
  readonly entityType?: string | undefined;
  readonly entityId?: Uuid | undefined;
  readonly action?: string | undefined;
}

export interface AuditLogRepository {
  /**
   * Re-binds this repository to a transaction the caller already opened. See
   * `VendorRepository.withTransaction` and `VendorKycRepository.withTransaction`,
   * which this mirrors exactly.
   *
   * Exists because a business operation and the audit record of it must
   * commit or roll back together (SDD 18.4: the log is "legally significant",
   * so an entry that outlives a rolled-back action — or a committed action
   * with no entry — is exactly the failure this closes). A caller that opened
   * a transaction for its own writes calls this once to fold the audit write
   * into the same one.
   *
   * `append` needs no `inCallerTransaction` guard the way
   * `PrismaVendorKycRepository.create` does: it was already a single
   * statement on whatever client the constructor received, so there is no
   * self-opened transaction to avoid nesting. The scoped instance simply
   * issues that same single statement on the caller's connection instead of
   * its own.
   */
  withTransaction(scope: TransactionScope): AuditLogRepository;

  append(entry: AuditLogEntry): Promise<void>;

  /**
   * Most recent first. `limit` is required rather than defaulted: this table
   * grows without bound and is never pruned, so every caller is made to state
   * how much of it it intends to pull into memory.
   */
  findByActor(actorId: UserId, limit: number): Promise<readonly AuditLogEntry[]>;

  /** Most recent first, same bounding rule as `findByActor`. */
  findByEntity(
    entityType: string,
    entityId: Uuid,
    limit: number,
  ): Promise<readonly AuditLogEntry[]>;

  /**
   * The general, filterable, cursor-paginated browse (Phase L.3) — what
   * `GET /api/v1/admin/audit-logs` reads from. Most recent first, same as the
   * two finders above.
   *
   * `idx_audit_created_at (created_at)` exists with no caller until this
   * method: this is the query it was always built for.
   *
   * **The cursor is composite, `createdAt` and `id` together, and that is not
   * decoration.** `audit_logs`' primary key is `(id, created_at)` — required
   * because the table is range-partitioned monthly on `created_at`, so
   * PostgreSQL mandates the partition key be part of any unique constraint —
   * which means `id` alone cannot seek a keyset position, and two entries
   * recorded in the same millisecond (routine under concurrent admin actions)
   * would let a timestamp-only cursor skip or repeat rows at the page
   * boundary. Mirrors `PrismaNotificationReadRepository.listForRecipient`'s
   * own `createdAt|id` cursor exactly, the one other place in this codebase
   * already solved this.
   */
  listPage(filter: ListAuditLogEntriesFilter): Promise<AuditLogEntryPage>;
}
