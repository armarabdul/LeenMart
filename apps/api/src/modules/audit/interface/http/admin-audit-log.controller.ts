import type { Request, Response } from 'express';
import type { AuditLogEntryDto, ListAuditLogEntriesQuery } from '@leen-mart/contracts';
import { toUuid } from '@leen-mart/domain-kit';
import { getRequestId } from '../../../../shared/interface/http/middleware/request-context.js';
import { validatedData } from '../../../../shared/interface/http/middleware/validate.js';
import { toUserId } from '../../../identity/index.js';
import type { AuditLogEntry } from '../../domain/entities/audit-log-entry.entity.js';
import type { ListAuditLogEntriesUseCase } from '../../application/use-cases/list-audit-log-entries.use-case.js';

export interface AdminAuditLogController {
  readonly list: (req: Request, res: Response) => Promise<void>;
}

export interface AdminAuditLogControllerDeps {
  readonly listAuditLogEntriesUseCase: ListAuditLogEntriesUseCase;
}

/**
 * Mapped field by field, never spread — the same reason every other admin
 * read-model mapper in this codebase gives (`toAdminUser`,
 * `adminKycSubmissionDetailSchema`'s own mapper): a column added to
 * `audit_logs` later fails loudly here instead of being published by a
 * spread.
 */
const toAuditLogEntryDto = (entry: AuditLogEntry): AuditLogEntryDto => ({
  id: entry.id,
  actorId: entry.actorId,
  actorRole: entry.actorRole,
  impersonatedBy: entry.impersonatedBy,
  action: entry.action,
  entityType: entry.entityType,
  entityId: entry.entityId,
  before: entry.before,
  after: entry.after,
  reason: entry.reason,
  ipAddress: entry.ipAddress,
  userAgent: entry.userAgent,
  requestId: entry.requestId,
  createdAt: entry.createdAt.toISOString(),
});

/**
 * Thin HTTP adapter for the `VIEW_AUDIT_LOG`-gated audit-log read surface
 * (Phase L.3). Parses nothing itself, decides nothing, translates no errors
 * — `validate()` and the global error handler own those (SDD 17.1).
 */
export const createAdminAuditLogController = (
  deps: AdminAuditLogControllerDeps,
): AdminAuditLogController => ({
  list: async (req: Request, res: Response): Promise<void> => {
    const { query } = validatedData<unknown, ListAuditLogEntriesQuery>(req);

    const page = await deps.listAuditLogEntriesUseCase.execute({
      limit: query.limit,
      cursor: query.cursor,
      actorId: query.actorId ? toUserId(query.actorId) : undefined,
      entityType: query.entityType,
      entityId: query.entityId ? toUuid(query.entityId) : undefined,
      action: query.action,
    });

    res.status(200).json({
      data: page.items.map(toAuditLogEntryDto),
      meta: {
        requestId: getRequestId(),
        pagination: { nextCursor: page.nextCursor, hasMore: page.hasMore },
      },
    });
  },
});
