import type { IdentityDomainEvent } from './identity-domain-event.js';
import type { UserId } from '../value-objects/user-id.value-object.js';
import type { SessionId } from '../value-objects/session-id.value-object.js';

export interface UserLoggedInEvent extends IdentityDomainEvent<'identity.user.logged-in'> {
  readonly userId: UserId;
  readonly sessionId: SessionId;
}

export const createUserLoggedInEvent = (props: {
  userId: UserId;
  sessionId: SessionId;
  now: Date;
}): UserLoggedInEvent => ({
  type: 'identity.user.logged-in',
  boundedContext: 'identity',
  occurredAt: props.now,
  userId: props.userId,
  sessionId: props.sessionId,
});
