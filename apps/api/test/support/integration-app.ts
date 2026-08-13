import { PrismaClient } from '@prisma/client';
import type { Express } from 'express';
import { createApp } from '../../src/app.js';
import { createContainer, type Container } from '../../src/container.js';

/**
 * The bootstrap every integration suite already performs by hand, in one
 * place — introduced for the cross-tenant route matrix (S2-1), which needs
 * the real application and an operator-level database connection at once.
 *
 * Deliberately minimal, and deliberately **not** retrofitted onto the
 * existing suites: those pass, and rewriting them would put unrelated churn
 * in a security commit. New suites may use this; old ones keep their own
 * setup until there is a reason to touch them.
 */
export interface IntegrationHarness {
  readonly container: Container;
  readonly app: Express;
  /**
   * An **owner** connection, not `container.prisma`.
   *
   * The container's client is the vendor-scoped runtime client
   * (KYC-2B-2/2B-3): outside a request it carries no tenant context, so a
   * tenant-scoped read through it fails closed — correctly. A test seeding
   * fixtures or inspecting stored state is acting as an operator and should
   * connect like one. This is the same reasoning `vendor.test.ts` records
   * for its own `db`.
   */
  readonly db: PrismaClient;
}

export const createIntegrationHarness = (): IntegrationHarness => {
  process.env.ENV_FILE = '.env.test';
  const container = createContainer();
  return {
    container,
    app: createApp(container),
    db: new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL ?? '' } } }),
  };
};

/**
 * Tears down everything the harness opened and removes every row belonging to
 * an account whose email carries `emailPrefix`.
 *
 * Rows are deleted child-first rather than relying on cascade, so a suite that
 * leaves a row behind fails loudly here instead of silently accumulating
 * fixtures across runs.
 */
export const disposeIntegrationHarness = async (
  harness: IntegrationHarness,
  emailPrefix: string,
): Promise<void> => {
  const { container, db } = harness;
  const users = await db.user.findMany({
    where: { email: { contains: emailPrefix } },
    select: { id: true },
  });
  const ids = users.map((user) => user.id);

  // Child-first, because every foreign key here is RESTRICT: a vendor cannot
  // be removed while a product points at it, and a product cannot be removed
  // while a variant does.
  const vendors = await db.vendorProfile.findMany({
    where: { userId: { in: ids } },
    select: { id: true },
  });
  const vendorIds = vendors.map((vendor) => vendor.id);

  await db.inventory.deleteMany({ where: { vendorId: { in: vendorIds } } });
  await db.productVariant.deleteMany({ where: { vendorId: { in: vendorIds } } });
  await db.product.deleteMany({ where: { vendorId: { in: vendorIds } } });
  await db.vendorProfile.deleteMany({ where: { id: { in: vendorIds } } });
  await db.address.deleteMany({ where: { userId: { in: ids } } });
  await db.user.deleteMany({ where: { id: { in: ids } } });
  await db.$disconnect();
  await container.dispose();
};
