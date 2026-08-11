import type { Uuid } from '@leen-mart/domain-kit';
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
export interface AuditLogRepository {
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
}
