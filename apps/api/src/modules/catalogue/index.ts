// This module's published interface (SDD 5.1). Other modules must import
// from here, never from `./domain/**` or `./application/**` directly.
//
// Taxonomy only at this milestone: products, variants, media, inventory,
// moderation and search are later chunks of Stage 2 and publish nothing yet.
export { createCatalogueModule } from './catalogue.module.js';
export type { CatalogueModule, CatalogueModuleDeps } from './catalogue.module.js';

// The worker process's composition root (S2-6b) — a second entry point into
// the same module, consumed by `src/worker.ts` rather than by `src/app.ts`.
export { createCatalogueMediaWorker } from './catalogue-worker.module.js';
export type { CatalogueMediaWorkerDeps } from './catalogue-worker.module.js';

export * from './domain/index.js';
