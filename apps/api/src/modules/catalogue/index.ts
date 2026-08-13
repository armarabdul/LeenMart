// This module's published interface (SDD 5.1). Other modules must import
// from here, never from `./domain/**` or `./application/**` directly.
//
// Taxonomy only at this milestone: products, variants, media, inventory,
// moderation and search are later chunks of Stage 2 and publish nothing yet.
export { createCatalogueModule } from './catalogue.module.js';
export type { CatalogueModule, CatalogueModuleDeps } from './catalogue.module.js';

export * from './domain/index.js';
