import type { IdentityDomainEvent } from './identity-domain-event.js';
import type { UserId } from '../value-objects/user-id.value-object.js';
import type { VendorId } from '../value-objects/vendor-id.value-object.js';
import type { Email } from '../value-objects/email.value-object.js';

/** `email` is required, not optional: a vendor's primary authentication is email + password. */
export interface VendorRegisteredEvent extends IdentityDomainEvent<'identity.vendor.registered'> {
  readonly userId: UserId;
  readonly vendorId: VendorId;
  readonly email: Email;
}

export const createVendorRegisteredEvent = (props: {
  userId: UserId;
  vendorId: VendorId;
  email: Email;
  now: Date;
}): VendorRegisteredEvent => ({
  type: 'identity.vendor.registered',
  boundedContext: 'identity',
  occurredAt: props.now,
  userId: props.userId,
  vendorId: props.vendorId,
  email: props.email,
});
