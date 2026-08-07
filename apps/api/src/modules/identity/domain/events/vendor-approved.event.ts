import type { IdentityDomainEvent } from './identity-domain-event.js';
import type { VendorId } from '../value-objects/vendor-id.value-object.js';
import type { UserId } from '../value-objects/user-id.value-object.js';

export interface VendorApprovedEvent extends IdentityDomainEvent<'identity.vendor.approved'> {
  readonly vendorId: VendorId;
  readonly userId: UserId;
}

export const createVendorApprovedEvent = (props: {
  vendorId: VendorId;
  userId: UserId;
  now: Date;
}): VendorApprovedEvent => ({
  type: 'identity.vendor.approved',
  boundedContext: 'identity',
  occurredAt: props.now,
  vendorId: props.vendorId,
  userId: props.userId,
});
