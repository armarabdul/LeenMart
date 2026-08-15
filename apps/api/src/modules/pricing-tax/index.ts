export { createPricingTaxModule } from './pricing-tax.module.js';
export type { PricingTaxModule, PricingTaxModuleDeps } from './pricing-tax.module.js';

export * from './domain/index.js';

// The two use cases this module's own doc comment names S3-3 as "the
// intended caller" of — published so `order` can construct and call them
// through the module's own interface (SDD 5.1), rather than reaching into
// `application/**` directly.
export { ResolveCommissionUseCase } from './application/use-cases/resolve-commission.use-case.js';
export type {
  ResolveCommissionDeps,
  ResolveCommissionInput,
  CommissionResolution,
} from './application/use-cases/resolve-commission.use-case.js';
export { ResolveTaxUseCase } from './application/use-cases/resolve-tax.use-case.js';
export type {
  ResolveTaxDeps,
  ResolveTaxInput,
  TaxResolution,
  TaxResolved,
  TaxUnresolved,
} from './application/use-cases/resolve-tax.use-case.js';
