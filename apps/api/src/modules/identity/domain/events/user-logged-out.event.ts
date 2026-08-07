import type { IdentityDomainEvent } from './identity-domain-event.js';
import type { UserId } from '../value-objects/user-id.value-object.js';
import type { SessionId } from '../value-objects/session-id.value-object.js';

export interface UserLoggedOutEvent extends IdentityDomainEvent<'identity.user.logged-out'> {
  readonly userId: UserId;
  readonly sessionId: SessionId;
}

export const createUserLoggedOutEvent = (props: {
  userId: UserId;
  sessionId: SessionId;
  now: Date;
}): UserLoggedOutEvent => ({
  type: 'identity.user.logged-out',
  boundedContext: 'identity',
  occurredAt: props.now,
  userId: props.userId,
  sessionId: props.sessionId,
});
