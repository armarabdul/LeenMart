import type { DomainEvent } from './domain-event.js';

/**
 * Marks an event as belonging to the identity bounded context. Once other
 * bounded contexts (Catalog, Orders, Payments, ...) exist, each defines its
 * own equivalent marker extending the same `DomainEvent` base, so events
 * remain distinguishable by origin — via `boundedContext`, not just by
 * convention — without any one context depending on another's event types.
 *
 * `DomainEvent` itself stays generic and framework-free in ./domain-event.js
 * for now; moving it to @leen-mart/domain-kit is what actually lets other
 * modules reuse it (the cross-module ESLint boundary blocks reaching into
 * another module's domain/ directly) — tracked in the Milestone 2 backlog,
 * not done here.
 */
export interface IdentityDomainEvent<TType extends string> extends DomainEvent<TType> {
  readonly boundedContext: 'identity';
}
