// This module's single, intentional domain public surface. Code outside
// this module should import from the module's top-level index.ts, not
// reach into these files directly (SDD 5.1).

// entities
export * from './entities/order.entity.js';
export * from './entities/sub-order.entity.js';
export * from './entities/order-item.entity.js';
export * from './entities/payment-attempt.entity.js';

// value objects
export * from './value-objects/order-id.value-object.js';
export * from './value-objects/sub-order-id.value-object.js';
export * from './value-objects/order-item-id.value-object.js';
export * from './value-objects/order-status.value-object.js';
export * from './value-objects/payment-attempt-id.value-object.js';
export * from './value-objects/payment-attempt-status.value-object.js';
/** Not previously crossed a module boundary — added for `ConvertReservationToOrderUseCase` (Phase Next), the first caller outside `order` that needs to construct a `SubOrder` of its own. */
export * from './value-objects/fulfilment-mode.value-object.js';

// errors
export * from './errors/order-errors.js';

// repository interfaces
export * from './repositories/order.repository.js';
export * from './repositories/payment-attempt.repository.js';

// audit vocabulary
export * from './audit-actions.js';
