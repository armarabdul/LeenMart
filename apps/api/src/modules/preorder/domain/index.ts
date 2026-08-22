// This module's single, intentional domain public surface (SDD 5.1).

export * from './audit-actions.js';
export * from './outbox-events.js';

export * from './entities/preorder-campaign.entity.js';
export * from './entities/preorder-reservation.entity.js';
export * from './entities/preorder-payment-attempt.entity.js';

export * from './value-objects/campaign-id.value-object.js';
export * from './value-objects/reservation-id.value-object.js';
export * from './value-objects/payment-attempt-id.value-object.js';
export * from './value-objects/campaign-status.value-object.js';
export * from './value-objects/reservation-status.value-object.js';
export * from './value-objects/campaign-fulfilment-mode.value-object.js';
export * from './value-objects/payment-attempt-status.value-object.js';

export * from './errors/preorder-errors.js';

export * from './repositories/campaign.repository.js';
export * from './repositories/reservation.repository.js';
export * from './repositories/payment-attempt.repository.js';
