// This module's published interface (SDD 5.1). Other modules must import
// from here, never from `./domain/**` directly.
//
// `VendorId` is deliberately not re-exported here: it still lives in
// `identity` (a documented pre-existing SDD 5 discrepancy — `identity` also
// still owns the vendor domain events), and re-exporting it from two module
// interfaces would obscure which module actually owns it.
export { createVendorModule } from './vendor.module.js';
export type { VendorModule, VendorModuleDeps } from './vendor.module.js';

export * from './domain/index.js';
