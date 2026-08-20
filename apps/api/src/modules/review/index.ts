// This module's published interface (SDD 5.1). Other modules must import
// from here, never from `./domain/**`/`./application/**` directly.
export { createReviewModule } from './review.module.js';
export type { ReviewModule, ReviewModuleDeps } from './review.module.js';

export * from './domain/index.js';
