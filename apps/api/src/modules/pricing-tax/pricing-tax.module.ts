import type { PrismaClient } from '@prisma/client';
import type { Clock } from '@leen-mart/domain-kit';
import { PrismaCommissionRuleRepository } from './infrastructure/persistence/prisma-commission-rule.repository.js';
import { PrismaTaxRateRepository } from './infrastructure/persistence/prisma-tax-rate.repository.js';
import { ResolveCommissionUseCase } from './application/use-cases/resolve-commission.use-case.js';
import { ResolveTaxUseCase } from './application/use-cases/resolve-tax.use-case.js';

export interface PricingTaxModuleDeps {
  /** Plain, non-RLS client — `commission_rules`/`tax_rates` are platform-owned config, outside `TENANT_SCOPED_MODELS`, same as `categories`. */
  readonly prisma: PrismaClient;
  readonly clock: Clock;
}

export interface PricingTaxModule {
  readonly resolveCommissionUseCase: ResolveCommissionUseCase;
  readonly resolveTaxUseCase: ResolveTaxUseCase;
}

/**
 * This module's own composition root (SDD 2.3), mirroring every other
 * module's shape — except it publishes no `router`: S3-2 adds no HTTP
 * surface (no admin CRUD for rules/rates was approved, and nothing
 * customer- or vendor-facing calls this module yet). It is not wired into
 * `app.ts`, unlike every other module built so far: there is nothing for
 * `mountBusinessModules` (whose whole job is `app.use()`-ing routers) to do
 * with a module that has none. The future checkout module (S3-3) is the
 * intended caller — it will construct this module the same way
 * `catalogue.module.ts` already constructs `PrismaProductSearchQuery`
 * against `publicPrisma`, i.e. import `createPricingTaxModule` from this
 * module's own `index.ts`.
 */
export const createPricingTaxModule = (deps: PricingTaxModuleDeps): PricingTaxModule => {
  const { prisma, clock } = deps;

  const commissionRuleRepository = new PrismaCommissionRuleRepository(prisma);
  const taxRateRepository = new PrismaTaxRateRepository(prisma);

  const resolveCommissionUseCase = new ResolveCommissionUseCase({
    commissionRuleRepository,
    clock,
  });
  const resolveTaxUseCase = new ResolveTaxUseCase({ taxRateRepository, clock });

  return { resolveCommissionUseCase, resolveTaxUseCase };
};
