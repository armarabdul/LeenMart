import type { TransactionScope, Uuid } from '@leen-mart/domain-kit';
import type { UserId } from '../../../identity/index.js';
import type { AuditLogSnapshot } from '../../domain/entities/audit-log-entry.entity.js';

/**
 * What a caller states about the action it performed. Everything a caller
 * cannot know — the entry's own id, the clock reading, and SDD 18.4's three
 * transport facts (`requestId`, `ip`, `userAgent`) — is supplied by the writer.
 */
export interface AuditWriterInput {
  /** Null for an action with no signed-in human behind it (a job, a CLI). */
  readonly actorId: UserId | null;
  /**
   * Recorded as the role was *named at the time*, matching the entity's own
   * `string` rather than today's closed `RoleName` set: an entry retained for
   * eight years must still rehydrate after a role is renamed or removed.
   */
  readonly actorRole: string;
  readonly action: string;
  readonly entityType: string;
  readonly entityId: Uuid | null;
  readonly before?: AuditLogSnapshot | null;
  readonly after?: AuditLogSnapshot | null;
  readonly reason?: string | null;
  /** The admin behind a support impersonation session (SDD 8.2). No feature produces one yet. */
  readonly impersonatedBy?: UserId | null;
}

/**
 * The audit module's published write surface (SDD 5.1 makes `audit` one of the
 * four modules anything may depend on).
 *
 * A port rather than the repository directly, for one concrete reason: SDD
 * 18.4 requires `ip`, `userAgent` and `requestId` on *every* entry, and those
 * live in the ambient `RequestContext`, which is HTTP infrastructure. The
 * architecture lint forbids the application layer from importing
 * the interface layer, so a use case physically cannot read them — and threading
 * three transport values through every signature would put a transport concern
 * into the domain, which is exactly what `AsyncLocalStorage` was adopted to
 * avoid. The implementation reads them; callers state only what they did.
 *
 * `record` rejects rather than resolving when the entry cannot be persisted.
 * Callers decide what that means for their operation — see the note in
 * `AdminLoginStepTwoUseCase` for why the admin-authentication callers treat it
 * as fatal.
 */
export interface AuditWriter {
  /**
   * Re-binds this writer to a transaction the caller already opened, so
   * `record` joins it instead of writing independently.
   *
   * Mirrors `AuditLogRepository.withTransaction` one layer up: a use case
   * depends on `AuditWriter`, not the repository directly, precisely so it
   * never has to import the ambient `RequestContext` itself — so the
   * transaction-participation capability has to be republished here too, or
   * a caller that needs both the ambient transport facts *and* atomicity
   * would have no way to get both at once.
   */
  withTransaction(scope: TransactionScope): AuditWriter;

  record(input: AuditWriterInput): Promise<void>;
}
