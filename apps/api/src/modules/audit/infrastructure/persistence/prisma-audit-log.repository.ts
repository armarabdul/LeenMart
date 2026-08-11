import { Prisma, type PrismaClient } from '@prisma/client';
import { toUuid, type Uuid } from '@leen-mart/domain-kit';
import { toUserId, type UserId } from '../../../identity/index.js';
import {
  AuditLogEntry,
  type AuditLogSnapshot,
} from '../../domain/entities/audit-log-entry.entity.js';
import { toAuditLogEntryId } from '../../domain/value-objects/audit-log-entry-id.value-object.js';
import type { AuditLogRepository } from '../../domain/repositories/audit-log.repository.js';

interface AuditLogRow {
  readonly id: string;
  readonly actorId: string | null;
  readonly actorRole: string;
  readonly impersonatedBy: string | null;
  readonly action: string;
  readonly entityType: string;
  readonly entityId: string | null;
  readonly before: Prisma.JsonValue | null;
  readonly after: Prisma.JsonValue | null;
  readonly reason: string | null;
  readonly ipAddress: string | null;
  readonly userAgent: string | null;
  readonly requestId: string | null;
  readonly createdAt: Date;
}

/**
 * `before`/`after` are written as objects and read back as whatever the
 * column holds. The cast is the boundary doing its job: the domain declares
 * these are entity snapshots, and nothing between here and the column can
 * narrow a `JsonValue` any further without inspecting data the audit log has
 * no business interpreting.
 */
const toSnapshot = (value: Prisma.JsonValue | null): AuditLogSnapshot | null =>
  value === null ? null : (value as AuditLogSnapshot);

/**
 * A `Json?` column distinguishes SQL `NULL` from the JSON literal `null`, so
 * Prisma refuses a bare `null` and makes the caller say which one it means.
 * `DbNull` — SQL `NULL` — is the right one here: "no snapshot was captured",
 * matching how every other nullable column on this table reads.
 */
const toJsonInput = (
  snapshot: AuditLogSnapshot | null,
): Prisma.InputJsonValue | typeof Prisma.DbNull =>
  snapshot === null ? Prisma.DbNull : (snapshot as Prisma.InputJsonValue);

const toDomain = (row: AuditLogRow): AuditLogEntry =>
  AuditLogEntry.reconstitute({
    id: toAuditLogEntryId(row.id),
    actorId: row.actorId === null ? null : toUserId(row.actorId),
    actorRole: row.actorRole,
    impersonatedBy: row.impersonatedBy === null ? null : toUserId(row.impersonatedBy),
    action: row.action,
    entityType: row.entityType,
    entityId: row.entityId === null ? null : toUuid(row.entityId),
    before: toSnapshot(row.before),
    after: toSnapshot(row.after),
    reason: row.reason,
    ipAddress: row.ipAddress,
    userAgent: row.userAgent,
    requestId: row.requestId,
    createdAt: row.createdAt,
  });

/**
 * Maps rows to `AuditLogEntry` at the boundary; Prisma types never escape
 * this file (SDD 3.4).
 *
 * Append-only, and there is deliberately no `update`/`delete` to implement —
 * `audit_logs` carries a trigger that rejects both (and `TRUNCATE`), so a
 * method here would only be a slower way to reach the same error.
 */
export class PrismaAuditLogRepository implements AuditLogRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async append(entry: AuditLogEntry): Promise<void> {
    await this.prisma.auditLog.create({
      data: {
        id: entry.id,
        actorId: entry.actorId,
        actorRole: entry.actorRole,
        impersonatedBy: entry.impersonatedBy,
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId,
        before: toJsonInput(entry.before),
        after: toJsonInput(entry.after),
        reason: entry.reason,
        ipAddress: entry.ipAddress,
        userAgent: entry.userAgent,
        requestId: entry.requestId,
        // Written explicitly rather than left to the column default: an audit
        // timestamp is legally significant, so it must be the instant the
        // domain recorded via its `Clock`, not whenever the INSERT happened to
        // reach the database. Same choice `PrismaVendorRepository` makes.
        createdAt: entry.createdAt,
      },
    });
  }

  async findByActor(actorId: UserId, limit: number): Promise<readonly AuditLogEntry[]> {
    const rows = await this.prisma.auditLog.findMany({
      where: { actorId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit,
    });
    return rows.map(toDomain);
  }

  async findByEntity(
    entityType: string,
    entityId: Uuid,
    limit: number,
  ): Promise<readonly AuditLogEntry[]> {
    const rows = await this.prisma.auditLog.findMany({
      where: { entityType, entityId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit,
    });
    return rows.map(toDomain);
  }
}
