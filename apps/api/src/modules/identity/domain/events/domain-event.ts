/**
 * The minimal shared shape every identity domain event carries: which kind
 * of event this is, and when it happened. Nothing here concerns itself with
 * dispatch or persistence — the platform's existing transactional outbox
 * (`OutboxEvent`, SDD 4.2 / ADR-011) is the infrastructure that would relay
 * these; this milestone only defines the payloads.
 */
export interface DomainEvent<TType extends string> {
  readonly type: TType;
  readonly occurredAt: Date;
}
