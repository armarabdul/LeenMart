import type { PrismaClient } from '@prisma/client';
import type { Router } from 'express';
import type { AccessTokenService, SessionDenylist } from '../identity/index.js';
import { PrismaAuditLogRepository } from './infrastructure/persistence/prisma-audit-log.repository.js';
import { ListAuditLogEntriesUseCase } from './application/use-cases/list-audit-log-entries.use-case.js';
import { createAdminAuditLogController } from './interface/http/admin-audit-log.controller.js';
import { createAdminAuditLogRouter } from './interface/http/admin-audit-log.routes.js';

export interface AuditModuleDeps {
  /**
   * The plain `leenmart_app` client — the same one `AmbientAuditWriter` is
   * already constructed on everywhere in this codebase (e.g.
   * `identity.module.ts`'s `buildAuditWriter`). `audit_logs` carries no RLS
   * policy at all (Phase L.3 discovery), so there is nothing for
   * `adminPrisma`'s elevated credential to buy here.
   */
  readonly prisma: PrismaClient;
  readonly accessTokenService: AccessTokenService;
  readonly sessionDenylist: SessionDenylist;
}

export interface AuditModule {
  /** Mounted at `/api/v1/admin/audit-logs` (Phase L.3) — `VIEW_AUDIT_LOG`-gated read of the platform's audit trail. */
  readonly adminAuditLogRouter: Router;
}

/**
 * This module's own composition root (SDD 2.3), and its first: until now
 * `audit` published only persistence and the `AuditWriter` port other
 * modules call directly (see `index.ts`'s own comment, updated alongside
 * this file). `app.ts` knows nothing about Prisma here either — it hands
 * over the shared container's plain client and gets back a router.
 */
export const createAuditModule = (deps: AuditModuleDeps): AuditModule => {
  const auditLogRepository = new PrismaAuditLogRepository(deps.prisma);
  const listAuditLogEntriesUseCase = new ListAuditLogEntriesUseCase({ auditLogRepository });
  const controller = createAdminAuditLogController({ listAuditLogEntriesUseCase });

  return {
    adminAuditLogRouter: createAdminAuditLogRouter(
      controller,
      deps.accessTokenService,
      deps.sessionDenylist,
    ),
  };
};
