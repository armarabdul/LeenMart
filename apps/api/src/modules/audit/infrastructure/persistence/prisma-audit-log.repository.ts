import { Prisma, type PrismaClient } from '@prisma/client';
import { toUuid, type TransactionScope, type Uuid } from '@leen-mart/domain-kit';
import { toUserId, type UserId } from '../../../identity/index.js';
import {
  AuditLogEntry,
  type AuditLogSnapshot,
} from '../../domain/entities/audit-log-entry.entity.js';
import { toAuditLogEntryId } from '../../domain/value-objects/audit-log-entry-id.value-object.js';
import type {
  AuditLogEntryPage,
  AuditLogRepository,
  ListAuditLogEntriesFilter,
} from '../../domain/repositories/audit-log.repository.js';

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

/**
 * The page cursor: the sort key, both halves of it. Opaque to the client by
 * intent — a position in a list, not an id to construct — but not encrypted:
 * it carries only a timestamp and an id the caller can already see in the
 * page it came from. Mirrors `PrismaNotificationReadRepository`'s own
 * `encodeCursor`/`decodeCursor` exactly, the existing precedent for a
 * composite `(createdAt, id)` keyset in this codebase.
 */
const encodeCursor = (createdAt: Date, id: string): string => `${createdAt.toISOString()}|${id}`;

const decodeCursor = (cursor: string | undefined): { createdAt: Date; id: string } | null => {
  if (!cursor) return null;
  const separator = cursor.lastIndexOf('|');
  if (separator <= 0) return null;
  const createdAt = new Date(cursor.slice(0, separator));
  const id = cursor.slice(separator + 1);
  // A malformed cursor returns the first page rather than an error: it is a
  // position, and the honest answer to "I do not know where that is" is the
  // start of the list.
  return Number.isNaN(createdAt.getTime()) || id.length === 0 ? null : { createdAt, id };
};

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

  /**
   * Unwraps the opaque scope back into the Prisma transaction client it
   * actually is, exactly as `PrismaVendorRepository.withTransaction` does —
   * the simpler of the two existing patterns, not
   * `PrismaVendorKycRepository`'s: nothing here self-opens a transaction, so
   * there is no second constructor parameter to guard against nesting. The
   * cast is confined to this layer: the port cannot name `PrismaClient`
   * (SDD 2.3), and a `TransactionScope` can only come from
   * `TransactionRunner.run`, so nothing else can fabricate one.
   */
  withTransaction(scope: TransactionScope): AuditLogRepository {
    return new PrismaAuditLogRepository(scope as unknown as PrismaClient);
  }

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

  /**
   * The general, filterable, cursor-paginated browse (Phase L.3). Filters
   * compose as a plain `AND` — Prisma omits a key entirely when the value is
   * `undefined`, so an unset filter simply does not narrow the query.
   *
   * Keyset pagination, not offset: strictly older, or the same instant with a
   * lower id, the same tie-safe shape
   * `PrismaNotificationReadRepository.listForRecipient` already uses for the
   * identical `(createdAt, id)` compound-key problem. One row beyond the page
   * answers `hasMore` without a second count query.
   */
  async listPage(filter: ListAuditLogEntriesFilter): Promise<AuditLogEntryPage> {
    const cursor = decodeCursor(filter.cursor);
    const rows = await this.prisma.auditLog.findMany({
      where: {
        // Spread rather than assigned, one key per filter: with
        // `exactOptionalPropertyTypes`, Prisma's generated `WhereInput`
        // accepts a key being *absent* but not a key present with value
        // `undefined` — the same distinction `toJsonInput` draws between "no
        // snapshot" and a stored JSON null, applied here to the query shape
        // instead of a column.
        ...(filter.actorId !== undefined ? { actorId: filter.actorId } : {}),
        ...(filter.entityType !== undefined ? { entityType: filter.entityType } : {}),
        ...(filter.entityId !== undefined ? { entityId: filter.entityId } : {}),
        ...(filter.action !== undefined ? { action: filter.action } : {}),
        ...(cursor
          ? {
              OR: [
                { createdAt: { lt: cursor.createdAt } },
                { createdAt: cursor.createdAt, id: { lt: cursor.id } },
              ],
            }
          : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: filter.limit + 1,
    });

    const hasMore = rows.length > filter.limit;
    const page = hasMore ? rows.slice(0, filter.limit) : rows;
    const last = page.at(-1);

    return {
      items: page.map(toDomain),
      nextCursor: hasMore && last ? encodeCursor(last.createdAt, last.id) : null,
      hasMore,
    };
  }
}
