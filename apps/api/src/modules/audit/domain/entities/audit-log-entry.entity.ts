import type { Uuid } from '@leen-mart/domain-kit';
import type { UserId } from '../../../identity/index.js';
import type { AuditLogEntryId } from '../value-objects/audit-log-entry-id.value-object.js';

/**
 * A `before`/`after` state capture. An object rather than arbitrary JSON:
 * SDD 18.4 uses these to record what an entity looked like on either side of
 * an action, and an entity is always a set of named fields. `unknown` values
 * rather than a recursive JSON type — the audit log never interprets what it
 * stores, it only preserves it.
 */
export type AuditLogSnapshot = Readonly<Record<string, unknown>>;

/**
 * Who performed the action (SDD 18.4).
 *
 * `actorId` is nullable because `audit_logs.actor_id` is: not every audited
 * action has a signed-in human behind it, and a DPDP erasure (BR-16) may
 * remove the user long before the eight-year audit retention expires — which
 * is also why the column carries no foreign key to `users`. The entry must
 * outlive the actor.
 *
 * `actorRole` is a plain `string`, not identity's `RoleName`, and this is
 * deliberate. The column is `VARCHAR(50)` while `users.role` is an enum — an
 * audit entry records the role *as it was named at the time*, and a record
 * retained for eight years must still rehydrate after a future rename or
 * removal of a role. Narrowing it to today's closed set would turn a valid
 * historical row into an unreadable one.
 *
 * `impersonatedBy` records the admin behind a support impersonation session
 * (SDD 8.2 grants SUPPORT_AGENT and SUPER_ADMIN that permission); null for
 * the ordinary case where the actor is acting as themselves.
 */
export interface AuditLogActor {
  readonly actorId: UserId | null;
  readonly actorRole: string;
  readonly impersonatedBy: UserId | null;
}

/**
 * Where the action came from (SDD 18.4's `ip`, `userAgent`, `requestId`).
 *
 * Grouped because all three are transport facts supplied by the request
 * boundary rather than by the domain action itself — the same reasoning
 * `Address` uses to group `AddressDetails`. All nullable: an action taken by
 * a scheduled job or a CLI has no request behind it.
 *
 * `ipAddress` rather than SDD 18.4's shorter `ip`, matching the existing
 * `audit_logs.ip_address` column. It stays a `string` here: the column is
 * `INET`, so PostgreSQL itself is the authority on what is a well-formed
 * address, and re-implementing that check in the domain would be a second,
 * weaker copy of a validation that already holds.
 */
export interface AuditLogRequestContext {
  readonly ipAddress: string | null;
  readonly userAgent: string | null;
  readonly requestId: string | null;
}

export interface AuditLogEntryProps extends AuditLogActor, AuditLogRequestContext {
  readonly id: AuditLogEntryId;
  readonly action: string;
  readonly entityType: string;
  readonly entityId: Uuid | null;
  readonly before: AuditLogSnapshot | null;
  readonly after: AuditLogSnapshot | null;
  readonly reason: string | null;
  readonly createdAt: Date;
}

const requireText = (value: string, field: string): string => {
  if (value.trim().length === 0) {
    throw new TypeError(`An audit log entry requires a non-empty ${field}.`);
  }
  return value;
};

/**
 * One immutable entry in the admin action log (SDD 18.4).
 *
 * A domain artefact rather than an application log line: queryable by admins,
 * retained eight years, and legally significant in a dispute. That status is
 * what shapes this class — it is **append-only, and says so three times
 * over**: no mutator exists here, `AuditLogRepository` publishes no `update`
 * or `delete`, and a database trigger rejects `UPDATE`/`DELETE`/`TRUNCATE` on
 * the table outright. A correction is a new entry describing the correction,
 * never an edit to the original.
 *
 * The entry stores what it is told and interprets none of it. `action` and
 * `entityType` are free text because SDD 18.4 defines no closed vocabulary
 * for either, and inventing one here would constrain every module that has
 * yet to be built.
 *
 * This entity is deliberately not wired to any caller yet: it is persistence
 * only, following the same sequencing `MfaSecret` and `MfaChallenge` used —
 * the table and its mapping land first, the use cases that write to it land
 * with the chunks that own those actions.
 */
export class AuditLogEntry {
  private constructor(private readonly props: AuditLogEntryProps) {}

  /**
   * Records a new entry. Rejects a blank `action`, `entityType` or
   * `actorRole`: all three are `NOT NULL` in the database but an empty string
   * satisfies that constraint while making the entry useless as evidence —
   * exactly the case a legally significant record cannot afford to accept
   * quietly.
   */
  static record(props: {
    id: AuditLogEntryId;
    actor: AuditLogActor;
    action: string;
    entityType: string;
    entityId: Uuid | null;
    before: AuditLogSnapshot | null;
    after: AuditLogSnapshot | null;
    reason: string | null;
    context: AuditLogRequestContext;
    now: Date;
  }): AuditLogEntry {
    return new AuditLogEntry({
      id: props.id,
      actorId: props.actor.actorId,
      actorRole: requireText(props.actor.actorRole, 'actorRole'),
      impersonatedBy: props.actor.impersonatedBy,
      action: requireText(props.action, 'action'),
      entityType: requireText(props.entityType, 'entityType'),
      entityId: props.entityId,
      before: props.before,
      after: props.after,
      reason: props.reason,
      ipAddress: props.context.ipAddress,
      userAgent: props.context.userAgent,
      requestId: props.context.requestId,
      createdAt: props.now,
    });
  }

  /**
   * Rehydrates from persisted state, applying no defaults and — unlike
   * `record()` — no validation. A row written years ago under different rules
   * must always be readable: an audit trail that refuses to load the entry
   * someone is asking about has failed at the one job it has.
   */
  static reconstitute(props: AuditLogEntryProps): AuditLogEntry {
    return new AuditLogEntry(props);
  }

  get id(): AuditLogEntryId {
    return this.props.id;
  }

  get actorId(): UserId | null {
    return this.props.actorId;
  }

  get actorRole(): string {
    return this.props.actorRole;
  }

  get impersonatedBy(): UserId | null {
    return this.props.impersonatedBy;
  }

  get action(): string {
    return this.props.action;
  }

  get entityType(): string {
    return this.props.entityType;
  }

  get entityId(): Uuid | null {
    return this.props.entityId;
  }

  get before(): AuditLogSnapshot | null {
    return this.props.before;
  }

  get after(): AuditLogSnapshot | null {
    return this.props.after;
  }

  get reason(): string | null {
    return this.props.reason;
  }

  get ipAddress(): string | null {
    return this.props.ipAddress;
  }

  get userAgent(): string | null {
    return this.props.userAgent;
  }

  get requestId(): string | null {
    return this.props.requestId;
  }

  get createdAt(): Date {
    return this.props.createdAt;
  }

  /** True when the actor was acting through a support impersonation session (SDD 8.2). */
  isImpersonated(): boolean {
    return this.props.impersonatedBy !== null;
  }
}
