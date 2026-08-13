// This module's single, intentional domain public surface. Code outside
// this module should import from the module's top-level index.ts, not
// reach into these files directly (SDD 5.1).

// audit vocabulary
export * from './audit-actions.js';

// entities
export * from './entities/category.entity.js';

// value objects
export * from './value-objects/category-id.value-object.js';
export * from './value-objects/category-risk-level.value-object.js';
export * from './value-objects/category-slug.value-object.js';

// errors
export * from './errors/catalogue-errors.js';

// repository interfaces
export * from './repositories/category.repository.js';
