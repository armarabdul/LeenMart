import type { DomainEvent } from './domain-event.js';

/**
 * Marks an event as belonging to the catalogue bounded context — mirrors
 * `identity/domain/events/identity-domain-event.ts` exactly, one bounded
 * context over.
 */
export interface CatalogueDomainEvent<TType extends string> extends DomainEvent<TType> {
  readonly boundedContext: 'catalogue';
}
