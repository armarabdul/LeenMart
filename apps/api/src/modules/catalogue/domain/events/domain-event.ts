/**
 * The minimal shared shape every catalogue domain event carries: which kind
 * of event this is, and when it happened. Nothing here concerns itself with
 * dispatch or persistence — the platform's existing transactional outbox
 * (`OutboxEvent`, SDD 4.2 / ADR-011) is the infrastructure that would relay
 * these; this milestone only defines the payload and logs its construction
 * (S2-6b D-S2-6-H — no general outbox relay/consumer here).
 *
 * Duplicated from `identity/domain/events/domain-event.ts` rather than
 * shared, for the same reason that file gives: this stays framework-free in
 * each module's own `domain/` until it moves to `@leen-mart/domain-kit`
 * (tracked in the Milestone 2 backlog) — the cross-module ESLint boundary
 * would otherwise block one module reaching into another's domain directly.
 */
export interface DomainEvent<TType extends string> {
  readonly type: TType;
  readonly occurredAt: Date;
}
