import type { IdentityDomainEvent } from './identity-domain-event.js';
import type { OtpId } from '../value-objects/otp-id.value-object.js';
import type { UserId } from '../value-objects/user-id.value-object.js';

export interface OtpVerifiedEvent extends IdentityDomainEvent<'identity.otp.verified'> {
  readonly otpId: OtpId;
  readonly userId: UserId;
}

export const createOtpVerifiedEvent = (props: {
  otpId: OtpId;
  userId: UserId;
  now: Date;
}): OtpVerifiedEvent => ({
  type: 'identity.otp.verified',
  boundedContext: 'identity',
  occurredAt: props.now,
  otpId: props.otpId,
  userId: props.userId,
});
