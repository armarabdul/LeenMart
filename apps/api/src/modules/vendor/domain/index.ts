// This module's single, intentional domain public surface. Code outside
// this module should import from the module's top-level index.ts, not
// reach into these files directly (SDD 5.1).

// entities
export * from './entities/vendor-profile.entity.js';
export * from './entities/vendor-kyc.entity.js';
export * from './entities/kyc-document.entity.js';

// value objects
export * from './value-objects/vendor-status.value-object.js';
export * from './value-objects/kyc-id.value-object.js';
export * from './value-objects/kyc-document-id.value-object.js';
export * from './value-objects/kyc-document-type.value-object.js';
export * from './value-objects/kyc-rejection-reason.value-object.js';
export * from './value-objects/sensitive-fingerprint.value-object.js';
export * from './value-objects/pan.value-object.js';
export * from './value-objects/gstin.value-object.js';
export * from './value-objects/bank-account.value-object.js';

// domain services
export * from './services/identifier-fingerprinter.service.js';

// errors
export * from './errors/vendor-errors.js';
export * from './errors/kyc-errors.js';

// repository interfaces
export * from './repositories/vendor.repository.js';
export * from './repositories/vendor-kyc.repository.js';
