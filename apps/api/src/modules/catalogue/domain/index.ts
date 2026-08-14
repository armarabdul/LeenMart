// This module's single, intentional domain public surface. Code outside
// this module should import from the module's top-level index.ts, not
// reach into these files directly (SDD 5.1).

// audit vocabulary
export * from './audit-actions.js';

// domain events
export * from './events/domain-event.js';
export * from './events/catalogue-domain-event.js';
export * from './events/product-media-ready.event.js';

// entities
export * from './entities/category.entity.js';
export * from './entities/category-attribute.entity.js';
export * from './entities/product.entity.js';
export * from './entities/product-variant.entity.js';
export * from './entities/product-media.entity.js';
export * from './entities/product-media-variant.entity.js';
export * from './entities/inventory.entity.js';

// value objects
export * from './value-objects/category-id.value-object.js';
export * from './value-objects/category-attribute-id.value-object.js';
export * from './value-objects/category-attribute-type.value-object.js';
export * from './value-objects/category-risk-level.value-object.js';
export * from './value-objects/category-slug.value-object.js';
export * from './value-objects/product-id.value-object.js';
export * from './value-objects/product-variant-id.value-object.js';
export * from './value-objects/product-media-id.value-object.js';
export * from './value-objects/product-media-variant-id.value-object.js';
export * from './value-objects/product-rejection-reason.value-object.js';
export * from './value-objects/sku.value-object.js';

// errors
export * from './errors/catalogue-errors.js';

// repository interfaces
export * from './repositories/category.repository.js';
export * from './repositories/category-attribute.repository.js';
export * from './repositories/product.repository.js';
export * from './repositories/product-variant.repository.js';
export * from './repositories/product-media.repository.js';
export * from './repositories/product-media-variant.repository.js';
export * from './repositories/inventory.repository.js';
