// This module's single, intentional domain public surface. Application,
// infrastructure, and interface code within this module should import from
// here rather than reaching into individual entities/value-objects/errors/
// events/repositories/services files directly.
//
// Deliberately not re-exported: `refresh-token.entity.ts`, the
// backward-compatibility alias for `Session` (see that file's own comment).
// New code has no reason to reach for the deprecated name.

// entities
export * from './entities/user.entity.js';
export * from './entities/session.entity.js';
export * from './entities/vendor-profile.entity.js';
export * from './entities/otp.entity.js';

// value objects
export * from './value-objects/role.value-object.js';
export * from './value-objects/user-id.value-object.js';
export * from './value-objects/session-id.value-object.js';
export * from './value-objects/vendor-id.value-object.js';
export * from './value-objects/otp-id.value-object.js';
export * from './value-objects/email.value-object.js';
export * from './value-objects/phone-number.value-object.js';
export * from './value-objects/password-hash.value-object.js';
export * from './value-objects/otp-code.value-object.js';
export * from './value-objects/user-status.value-object.js';

// errors
export * from './errors/identity-errors.js';

// events
export * from './events/domain-event.js';
export * from './events/identity-domain-event.js';
export * from './events/customer-registered.event.js';
export * from './events/vendor-registered.event.js';
export * from './events/otp-verified.event.js';
export * from './events/user-logged-in.event.js';
export * from './events/user-logged-out.event.js';
export * from './events/password-changed.event.js';
export * from './events/vendor-approved.event.js';

// repository interfaces
export * from './repositories/user.repository.js';
export * from './repositories/session.repository.js';
export * from './repositories/vendor.repository.js';
export * from './repositories/otp.repository.js';

// service interfaces
export * from './services/password-hasher.service.js';
export * from './services/otp-generator.service.js';
export * from './services/otp-hasher.service.js';
export * from './services/token-generator.service.js';
export * from './services/token-hasher.service.js';
