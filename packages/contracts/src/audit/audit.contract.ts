import { z } from 'zod';
import { cursorPaginationSchema, isoDateTimeSchema, uuidSchema } from '../common/primitives.js';

/**
 * One audit-log entry as an administrator sees it (GET
 * `/api/v1/admin/audit-logs`, Phase L.3).
 *
 * Every field the domain entity publishes (SDD 18.4), and no more —
 * `.strict()` does the same job it does on `adminUserSchema`: a column added
 * to `audit_logs` later fails loudly here instead of being published by a
 * spread. `action`/`entityType`/`actorRole` stay plain strings rather than
 * closed enums, matching `AuditLogEntry`'s own reasoning: the log defines no
 * closed vocabulary, and narrowing one here would go stale the moment a new
 * module adds an action this schema has never heard of.
 *
 * `before`/`after` are `Record<string, unknown>` rather than a recursive JSON
 * type, mirroring `AuditLogSnapshot` — the wire format preserves whatever
 * shape the domain captured without trying to interpret it.
 */
export const auditLogEntrySchema = z
  .object({
    id: uuidSchema,
    actorId: uuidSchema.nullable(),
    actorRole: z.string(),
    impersonatedBy: uuidSchema.nullable(),
    action: z.string(),
    entityType: z.string(),
    entityId: uuidSchema.nullable(),
    before: z.record(z.unknown()).nullable(),
    after: z.record(z.unknown()).nullable(),
    reason: z.string().nullable(),
    ipAddress: z.string().nullable(),
    userAgent: z.string().nullable(),
    requestId: z.string().nullable(),
    createdAt: isoDateTimeSchema,
  })
  .strict();

/**
 * GET /api/v1/admin/audit-logs — the platform's existing cursor convention
 * (SDD 9.2), extended with the four filters `AuditLogRepository.listPage`
 * accepts. All four are optional and compose: narrowing by `actorId` and
 * `action` together is a normal request, not a special case.
 */
export const listAuditLogEntriesQuerySchema = cursorPaginationSchema
  .extend({
    actorId: uuidSchema.optional(),
    entityType: z.string().min(1).optional(),
    entityId: uuidSchema.optional(),
    action: z.string().min(1).optional(),
  })
  .strict();

export const listAuditLogEntriesResponseSchema = z.array(auditLogEntrySchema);

export type AuditLogEntryDto = z.infer<typeof auditLogEntrySchema>;
export type ListAuditLogEntriesQuery = z.infer<typeof listAuditLogEntriesQuerySchema>;
export type ListAuditLogEntriesResponse = z.infer<typeof listAuditLogEntriesResponseSchema>;
