// This module's published interface (SDD 5.1). Other modules must import
// from here, never from `./domain/**` directly.
export { createCustomerModule } from './customer.module.js';
export type { CustomerModule, CustomerModuleDeps } from './customer.module.js';

export * from './domain/index.js';
