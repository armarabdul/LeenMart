import type { Clock, IdGenerator } from '@leen-mart/domain-kit';
import { getRequestContext } from '../../../shared/interface/http/middleware/request-context.js';
import {
  AuditLogEntry,
  type AuditLogRequestContext,
} from '../domain/entities/audit-log-entry.entity.js';
import type { AuditLogRepository } from '../domain/repositories/audit-log.repository.js';
import { toAuditLogEntryId } from '../domain/value-objects/audit-log-entry-id.value-object.js';
import type { AuditWriter, AuditWriterInput } from '../application/ports/audit-writer.port.js';

export interface AmbientAuditWriterDeps {
  readonly auditLogRepository: AuditLogRepository;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
}

/**
 * SDD 18.4's three transport facts, read from the ambient request context.
 *
 * All three degrade to `null`, which the entity and the `audit_logs` columns
 * already permit: an action taken outside a request — a scheduled job, a CLI —
 * still has to be auditable.
 */
const ambientContext = (): AuditLogRequestContext => {
  const context = getRequestContext();
  return {
    ipAddress: context?.ip ?? null,
    userAgent: context?.userAgent ?? null,
    requestId: context?.requestId ?? null,
  };
};

/**
 * Writes audit entries, taking SDD 18.4's `requestId`, `ip` and `userAgent`
 * from the ambient request context rather than from the caller.
 *
 * This lives in `infrastructure/` specifically because it reads that context:
 * `getRequestContext()` is HTTP middleware state, and the architecture lint
 * forbids the application layer from importing the interface layer. Keeping the
 * one import that crosses that line in an adapter is what lets every use case
 * depend on the `AuditWriter` port instead.
 */
export class AmbientAuditWriter implements AuditWriter {
  constructor(private readonly deps: AmbientAuditWriterDeps) {}

  async record(input: AuditWriterInput): Promise<void> {
    const { auditLogRepository, idGenerator, clock } = this.deps;

    const entry = AuditLogEntry.record({
      id: toAuditLogEntryId(idGenerator.generate()),
      actor: {
        actorId: input.actorId,
        actorRole: input.actorRole,
        impersonatedBy: input.impersonatedBy ?? null,
      },
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      before: input.before ?? null,
      after: input.after ?? null,
      reason: input.reason ?? null,
      context: ambientContext(),
      now: clock.now(),
    });

    // Deliberately unguarded: a rejection propagates to the caller rather than
    // being swallowed here. Whether a failed audit write should fail the
    // action is the caller's decision, and this adapter is not the place to
    // make it silently for everyone.
    await auditLogRepository.append(entry);
  }
}
