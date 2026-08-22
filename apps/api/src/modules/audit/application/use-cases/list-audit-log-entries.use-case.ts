import type { Uuid } from '@leen-mart/domain-kit';
import type { UserId } from '../../../identity/index.js';
import type {
  AuditLogEntryPage,
  AuditLogRepository,
} from '../../domain/repositories/audit-log.repository.js';

export interface ListAuditLogEntriesInput {
  readonly limit: number;
  readonly cursor?: string | undefined;
  readonly actorId?: UserId | undefined;
  readonly entityType?: string | undefined;
  readonly entityId?: Uuid | undefined;
  readonly action?: string | undefined;
}

export interface ListAuditLogEntriesDeps {
  readonly auditLogRepository: AuditLogRepository;
}

/**
 * One page of the platform's audit trail (SDD 18.4) for the
 * `VIEW_AUDIT_LOG`-gated read surface (Phase L.3). A read — no transaction,
 * no audit record of its own, mirroring `ListAdminUsersUseCase` exactly: an
 * audit-log read is not itself an auditable action anywhere else in this
 * codebase either.
 */
export class ListAuditLogEntriesUseCase {
  constructor(private readonly deps: ListAuditLogEntriesDeps) {}

  execute(input: ListAuditLogEntriesInput): Promise<AuditLogEntryPage> {
    return this.deps.auditLogRepository.listPage(input);
  }
}
