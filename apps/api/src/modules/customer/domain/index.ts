// This module's single, intentional domain public surface. Code outside
// this module should import from the module's top-level index.ts, not
// reach into these files directly (SDD 5.1).

// entities
export * from './entities/address.entity.js';

// value objects
export * from './value-objects/address-id.value-object.js';

// errors
export * from './errors/customer-errors.js';

// repository interfaces
export * from './repositories/address.repository.js';
