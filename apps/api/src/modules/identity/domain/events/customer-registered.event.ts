import type { IdentityDomainEvent } from './identity-domain-event.js';
import type { UserId } from '../value-objects/user-id.value-object.js';
import type { Email } from '../value-objects/email.value-object.js';
import type { PhoneNumber } from '../value-objects/phone-number.value-object.js';

/** Both `email` and `phone` are optional: a customer may register with either, per the customer auth strategy (phone+OTP primary, email optional). */
export interface CustomerRegisteredEvent
  extends IdentityDomainEvent<'identity.customer.registered'> {
  readonly userId: UserId;
  readonly email?: Email;
  readonly phone?: PhoneNumber;
}

export const createCustomerRegisteredEvent = (props: {
  userId: UserId;
  email?: Email;
  phone?: PhoneNumber;
  now: Date;
}): CustomerRegisteredEvent => ({
  type: 'identity.customer.registered',
  boundedContext: 'identity',
  occurredAt: props.now,
  userId: props.userId,
  ...(props.email ? { email: props.email } : {}),
  ...(props.phone ? { phone: props.phone } : {}),
});
