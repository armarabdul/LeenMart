import type { IdentityDomainEvent } from './identity-domain-event.js';
import type { UserId } from '../value-objects/user-id.value-object.js';

/** Deliberately carries no password/hash material — an event payload is not the place for it. */
export interface PasswordChangedEvent extends IdentityDomainEvent<'identity.user.password-changed'> {
  readonly userId: UserId;
}

export const createPasswordChangedEvent = (props: { userId: UserId; now: Date }): PasswordChangedEvent => ({
  type: 'identity.user.password-changed',
  boundedContext: 'identity',
  occurredAt: props.now,
  userId: props.userId,
});
