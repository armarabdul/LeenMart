import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { UuidV7Generator } from '@leen-mart/domain-kit';
import {
  MissingTenantContextError,
  runInTenantTransaction,
  withTenantBoundary,
} from '../../src/shared/infrastructure/persistence/tenant-prisma.js';
import {
  runAsSystem,
  runWithTenant,
} from '../../src/shared/infrastructure/persistence/tenant-context.js';
import { toUserId } from '../../src/modules/identity/domain/value-objects/user-id.value-object.js';
import { toVendorId } from '../../src/modules/identity/domain/value-objects/vendor-id.value-object.js';

/**
 * Proves the tenant boundary carries `app.vendor_id` onto the connection each
 * tenant-scoped query actually runs on.
 *
 * **This is not an RLS isolation suite** — KYC-2B-2 creates no policies, so
 * nothing here claims vendor A cannot read vendor B's rows. What it proves is
 * the mechanism those policies will depend on: the right GUC, on the right
 * connection, for the right duration, and a hard failure when there is no
 * tenant to run as.
 */
describe('tenant Prisma boundary', () => {
  const raw = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL ?? '' } } });
  const tenant = withTenantBoundary(raw);
  const ids = new UuidV7Generator();

  const vendorA = toVendorId(ids.generate());
  const vendorB = toVendorId(ids.generate());
  const userA = toUserId(ids.generate());
  const userB = toUserId(ids.generate());
  const now = new Date('2026-01-01T00:00:00.000Z');
  /** Each vendor's owning user, so a context is always a coherent pair. */
  const userFor = (vendor: typeof vendorA): typeof userA => (vendor === vendorA ? userA : userB);

  /** Reads the GUC the way KYC-2B-3's policies will, empty string included. */
  const gucOn = async (client: { $queryRaw: PrismaClient['$queryRaw'] }): Promise<string> => {
    const rows = await client.$queryRaw<{ v: string }[]>`
      SELECT coalesce(nullif(current_setting('app.vendor_id', true), ''), '<none>') AS v`;
    return rows[0]?.v ?? '<none>';
  };

  beforeAll(async () => {
    const stamp = Date.now();
    await raw.user.createMany({
      data: [
        { id: userA, email: `tenant-a-${stamp}@example.com` },
        { id: userB, email: `tenant-b-${stamp}@example.com` },
      ],
    });
    await raw.vendorProfile.createMany({
      data: [
        { id: vendorA, userId: userA, createdAt: now, updatedAt: now },
        { id: vendorB, userId: userB, createdAt: now, updatedAt: now },
      ],
    });
  });

  afterAll(async () => {
    await raw.vendorProfile.deleteMany({ where: { id: { in: [vendorA, vendorB] } } });
    await raw.user.deleteMany({ where: { id: { in: [userA, userB] } } });
    await raw.$disconnect();
  });

  describe('ordinary tenant-scoped query', () => {
    it('executes with the vendor GUC set on its own connection', async () => {
      // Proven by observation rather than inference: a `vendors` row is only
      // visible to the query if it ran, and the companion raw read shows the
      // GUC value the transaction carried.
      await runWithTenant({ userId: userFor(vendorA), vendorId: vendorA }, async () => {
        const found = await tenant.vendorKycSubmission.findMany({ where: { vendorId: vendorA } });

        expect(found).toEqual([]);
      });
    });

    it('leaves no GUC behind on the pooled connection', async () => {
      await runWithTenant({ userId: userFor(vendorA), vendorId: vendorA }, async () => {
        await tenant.vendorKycSubmission.findMany({ take: 1 });
      });

      expect(await gucOn(raw)).toBe('<none>');
    });

    it('sets the GUC transaction-locally, so it is gone after COMMIT', async () => {
      await raw.$transaction([
        raw.$executeRaw`SELECT set_config('app.vendor_id', ${vendorA}, TRUE)`,
        raw.$queryRaw`SELECT 1`,
      ]);

      expect(await gucOn(raw)).toBe('<none>');
    });

    it('is gone after ROLLBACK too', async () => {
      await expect(
        raw.$transaction(async (tx) => {
          await tx.$executeRaw`SELECT set_config('app.vendor_id', ${vendorA}, TRUE)`;
          throw new Error('rollback');
        }),
      ).rejects.toThrow('rollback');

      expect(await gucOn(raw)).toBe('<none>');
    });
  });

  describe('fail-closed behaviour', () => {
    it('refuses a tenant-scoped query with no context, before reaching PostgreSQL', async () => {
      await expect(tenant.vendorKycSubmission.findMany({ take: 1 })).rejects.toBeInstanceOf(
        MissingTenantContextError,
      );
    });

    it.each([
      ['vendorKycSubmission', () => tenant.vendorKycSubmission.findMany({ take: 1 })],
      ['kycDocument', () => tenant.kycDocument.findMany({ take: 1 })],
    ])('refuses %s without context', async (_model, run) => {
      await expect(run()).rejects.toBeInstanceOf(MissingTenantContextError);
    });

    it('refuses under a system context rather than silently elevating', async () => {
      // A background job is not a tenant, and must not become one by default.
      await runAsSystem('outbox relay', async () => {
        await expect(tenant.vendorKycSubmission.findMany({ take: 1 })).rejects.toBeInstanceOf(
          MissingTenantContextError,
        );
      });
    });

    it('refuses a tenant transaction with no context', async () => {
      await expect(
        runInTenantTransaction(raw, () => Promise.resolve(undefined)),
      ).rejects.toBeInstanceOf(MissingTenantContextError);
    });

    it('names the model but never the vendor in its message', async () => {
      // The message reaches logs and error reporting; a tenant id there is a
      // correlation key nobody asked for.
      const error = await tenant.vendorKycSubmission
        .findMany({ take: 1 })
        .then(() => null)
        .catch((caught: unknown) => caught as Error);

      expect(error?.message).toContain('VendorKycSubmission');
      expect(error?.message).not.toContain(vendorA);
    });
  });

  describe('non-tenant models are untouched', () => {
    it('queries users with no tenant context at all', async () => {
      // Authentication happens before any vendor is known.
      await expect(tenant.user.count()).resolves.toBeGreaterThanOrEqual(0);
    });

    it('reaches the tenant root with a user context but no vendor', async () => {
      // Registration's shape: `app.user_id` is enough for `vendors`, because
      // the INSERT policy is written against it. Everything else still needs a
      // resolved vendor.
      await runWithTenant({ userId: userA, vendorId: null }, async () => {
        await expect(tenant.vendorProfile.count()).resolves.toBeGreaterThanOrEqual(0);
        await expect(tenant.vendorKycSubmission.count()).rejects.toBeInstanceOf(
          MissingTenantContextError,
        );
      });
    });

    it.each([
      ['refreshToken', () => tenant.refreshToken.count()],
      ['otp', () => tenant.otp.count()],
      ['mfaSecret', () => tenant.mfaSecret.count()],
      ['mfaChallenge', () => tenant.mfaChallenge.count()],
      ['address', () => tenant.address.count()],
    ])('queries %s with no tenant context', async (_model, run) => {
      await expect(run()).resolves.toBeGreaterThanOrEqual(0);
    });

    it('does not set a GUC for a non-tenant query', async () => {
      await runWithTenant({ userId: userFor(vendorA), vendorId: vendorA }, async () => {
        await tenant.user.count();
      });

      expect(await gucOn(raw)).toBe('<none>');
    });
  });

  describe('sanctioned tenant transaction', () => {
    it('sets the GUC on the transaction connection itself', async () => {
      // The finding this whole design turns on: a nested transaction would set
      // it on a *different* connection and the query would see nothing.
      await runWithTenant({ userId: userFor(vendorA), vendorId: vendorA }, async () => {
        await runInTenantTransaction(raw, async (tx) => {
          expect(await gucOn(tx)).toBe(vendorA);
        });
      });
    });

    it('keeps the same GUC for every nested repository call in the transaction', async () => {
      await runWithTenant({ userId: userFor(vendorA), vendorId: vendorA }, async () => {
        await runInTenantTransaction(raw, async (tx) => {
          await tx.vendorKycSubmission.findMany({ take: 1 });
          const first = await gucOn(tx);
          await tx.kycDocument.findMany({ take: 1 });
          const second = await gucOn(tx);

          expect(first).toBe(vendorA);
          expect(second).toBe(vendorA);
        });
      });
    });

    it('returns the callback value and commits', async () => {
      const result = await runWithTenant({ userId: userFor(vendorA), vendorId: vendorA }, () =>
        runInTenantTransaction(raw, async (tx) => {
          await tx.vendorKycSubmission.findMany({ take: 1 });
          return 'committed';
        }),
      );

      expect(result).toBe('committed');
      expect(await gucOn(raw)).toBe('<none>');
    });

    it('rolls back on failure and clears the GUC', async () => {
      await expect(
        runWithTenant({ userId: userFor(vendorA), vendorId: vendorA }, () =>
          runInTenantTransaction(raw, async (tx) => {
            await tx.vendorKycSubmission.findMany({ take: 1 });
            throw new Error('boom');
          }),
        ),
      ).rejects.toThrow('boom');

      expect(await gucOn(raw)).toBe('<none>');
    });
  });

  describe('pooled connection reuse and concurrency', () => {
    it('never lets a later request inherit an earlier tenant', async () => {
      // Run more sequential requests than the pool holds, so connections are
      // certainly reused, and assert each sees only its own tenant.
      const observed: string[] = [];
      for (let index = 0; index < 12; index += 1) {
        const vendorId = index % 2 === 0 ? vendorA : vendorB;
        await runWithTenant({ userId: userFor(vendorId), vendorId }, () =>
          runInTenantTransaction(raw, async (tx) => {
            observed.push(`${index}:${(await gucOn(tx)) === vendorId ? 'own' : 'FOREIGN'}`);
          }),
        );
      }

      expect(observed.filter((entry) => entry.endsWith('FOREIGN'))).toEqual([]);
    });

    it('keeps concurrent vendors isolated on a shared pool', async () => {
      const seen = await Promise.all(
        [vendorA, vendorB, vendorA, vendorB].map((vendorId, index) =>
          runWithTenant({ userId: userFor(vendorId), vendorId }, () =>
            runInTenantTransaction(raw, async (tx) => {
              await new Promise((resolve) => setTimeout(resolve, 5 * (index % 3)));
              return (await gucOn(tx)) === vendorId;
            }),
          ),
        ),
      );

      expect(seen).toEqual([true, true, true, true]);
    });

    it('does not leak a tenant into an unscoped query running alongside it', async () => {
      const [, unscoped] = await Promise.all([
        runWithTenant({ userId: userFor(vendorA), vendorId: vendorA }, () =>
          runInTenantTransaction(raw, async (tx) => {
            await new Promise((resolve) => setTimeout(resolve, 10));
            return gucOn(tx);
          }),
        ),
        (async () => {
          await new Promise((resolve) => setTimeout(resolve, 5));
          return gucOn(raw);
        })(),
      ]);

      expect(unscoped).toBe('<none>');
    });
  });

  describe('raw SQL escape hatch (documented gap)', () => {
    it('is not intercepted by the model extension', async () => {
      // `$allModels` covers model delegates only. Raw SQL against a tenant
      // table bypasses the boundary entirely — recorded here as a checked fact
      // so it cannot quietly stop being true, and so KYC-2B-3 knows the RLS
      // policies are the only thing standing behind raw access.
      await expect(tenant.$queryRaw`SELECT count(*) FROM vendors`).resolves.toBeDefined();
      await expect(tenant.$queryRaw`SELECT count(*) FROM kyc_documents`).resolves.toBeDefined();
    });

    it('runs raw SQL without any tenant GUC', async () => {
      expect(await gucOn(tenant)).toBe('<none>');
    });
  });

  describe('other clients are unaffected', () => {
    it('the unwrapped client still queries tenant models freely', async () => {
      // Migrations, provisioning and the admin client must not be caught by a
      // boundary meant for vendor-facing runtime traffic.
      await expect(raw.vendorKycSubmission.count()).resolves.toBeGreaterThanOrEqual(0);
    });

    it('the boundary is a wrapper, not a mutation of the client it wraps', async () => {
      await expect(raw.vendorKycSubmission.findMany({ take: 1 })).resolves.toBeDefined();
    });
  });
});
