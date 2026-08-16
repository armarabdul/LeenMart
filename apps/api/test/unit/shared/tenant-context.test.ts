import { describe, expect, it } from 'vitest';
import {
  TENANT_SCOPED_MODELS,
  USER_ROOTED_MODELS,
  getTenantContext,
  runAsSystem,
  runWithTenant,
} from '../../../src/shared/infrastructure/persistence/tenant-context.js';
import { toUserId } from '../../../src/modules/identity/domain/value-objects/user-id.value-object.js';
import { toVendorId } from '../../../src/modules/identity/domain/value-objects/vendor-id.value-object.js';

const vendorA = toVendorId('00000000-0000-7000-8000-0000000a0001');
const vendorB = toVendorId('00000000-0000-7000-8000-0000000b0002');
const userA = toUserId('00000000-0000-7000-8000-0000000a1001');
const userB = toUserId('00000000-0000-7000-8000-0000000b1002');
/** Each vendor's owning user, so a context is always a coherent pair. */
const userFor = (vendorId: typeof vendorA): typeof userA => (vendorId === vendorA ? userA : userB);

describe('tenant context', () => {
  describe('establishment', () => {
    it('makes the vendor available inside the callback', async () => {
      await runWithTenant({ userId: userFor(vendorA), vendorId: vendorA }, () => {
        expect(getTenantContext()).toEqual({
          kind: 'authenticated',
          userId: userA,
          vendorId: vendorA,
          inTransaction: false,
        });
      });
    });

    it('is absent outside any scope', () => {
      expect(getTenantContext()).toBeUndefined();
    });

    it('is absent again after the scope ends', async () => {
      await runWithTenant({ userId: userFor(vendorA), vendorId: vendorA }, () => undefined);

      expect(getTenantContext()).toBeUndefined();
    });

    it('survives across awaits inside the scope', async () => {
      await runWithTenant({ userId: userFor(vendorA), vendorId: vendorA }, async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));

        expect(getTenantContext()).toMatchObject({ vendorId: vendorA });
      });
    });

    it('is absent inside a callback that escapes the scope', async () => {
      // A deferred callback scheduled outside the scope must not inherit it.
      let seen: unknown = 'unset';
      await runWithTenant({ userId: userFor(vendorA), vendorId: vendorA }, () => undefined);
      await new Promise((resolve) => {
        setTimeout(() => {
          seen = getTenantContext();
          resolve(undefined);
        }, 1);
      });

      expect(seen).toBeUndefined();
    });
  });

  describe('nesting', () => {
    it('an inner scope shadows the outer one deterministically', async () => {
      await runWithTenant({ userId: userFor(vendorA), vendorId: vendorA }, async () => {
        await runWithTenant({ userId: userFor(vendorB), vendorId: vendorB }, () => {
          expect(getTenantContext()).toMatchObject({ vendorId: vendorB });
        });

        expect(getTenantContext()).toMatchObject({ vendorId: vendorA });
      });
    });

    it('a system scope inside a vendor scope drops the vendor', async () => {
      await runWithTenant({ userId: userFor(vendorA), vendorId: vendorA }, async () => {
        await runAsSystem('partition maintenance', () => {
          expect(getTenantContext()).toEqual({ kind: 'system', reason: 'partition maintenance' });
        });
      });
    });
  });

  describe('isolation between concurrent scopes', () => {
    it('keeps interleaved vendors apart', async () => {
      // The property the whole mechanism rests on: two requests in flight on
      // one process must not see each other's tenant.
      const observe = async (vendorId: typeof vendorA, delay: number): Promise<unknown> =>
        runWithTenant({ userId: userFor(vendorId), vendorId }, async () => {
          await new Promise((resolve) => setTimeout(resolve, delay));
          return getTenantContext();
        });

      const [first, second, third] = await Promise.all([
        observe(vendorA, 20),
        observe(vendorB, 5),
        observe(vendorA, 12),
      ]);

      expect(first).toMatchObject({ vendorId: vendorA });
      expect(second).toMatchObject({ vendorId: vendorB });
      expect(third).toMatchObject({ vendorId: vendorA });
    });
  });

  describe('a caller with no vendor', () => {
    it('still establishes a user context, with a null vendor', async () => {
      // A customer registering a vendor needs `app.user_id` and cannot yet
      // have `app.vendor_id`; that is exactly what the tenant-root INSERT
      // policy is written against.
      await runWithTenant({ userId: userA, vendorId: null }, () => {
        expect(getTenantContext()).toMatchObject({ userId: userA, vendorId: null });
      });
    });
  });

  describe('system context', () => {
    it('carries no vendor id at all', async () => {
      // A background job is not a tenant. Giving it one would be inventing an
      // authorisation decision nobody made.
      await runAsSystem('outbox relay', () => {
        expect(getTenantContext()).not.toHaveProperty('vendorId');
      });
    });

    it('records why, so a system scope is greppable rather than anonymous', async () => {
      await runAsSystem('outbox relay', () => {
        expect(getTenantContext()).toMatchObject({ reason: 'outbox relay' });
      });
    });
  });

  describe('what the context is allowed to carry', () => {
    it('holds identity only — no tokens, sessions or credentials', async () => {
      // AsyncLocalStorage is ambient and ends up in diagnostics; the minimum
      // that has to reach PostgreSQL is a vendor id, so that is all it holds.
      await runWithTenant({ userId: userFor(vendorA), vendorId: vendorA }, () => {
        expect(Object.keys(getTenantContext() ?? {}).sort()).toEqual([
          'inTransaction',
          'kind',
          'userId',
          'vendorId',
        ]);
      });
    });
  });

  describe('model registry', () => {
    it('covers exactly the models KYC-2B-3, S2-3a, S2-4, S2-6a, S2-6b and S3-5 protect', () => {
      expect([...TENANT_SCOPED_MODELS].sort()).toEqual([
        'Inventory',
        'KycDocument',
        // S3-5: the vendor-order surface's own repository reads/writes these
        // through the wrapped `prisma` client, alongside — not instead of —
        // the unwrapped `leenmart_checkout` path the customer-facing order
        // surface already uses.
        'Order',
        'OrderItem',
        'Product',
        'ProductMedia',
        // S2-6b: the worker writes these under a tenant context of its own,
        // never on the admin credential.
        'ProductMediaVariant',
        'ProductVariant',
        'SubOrder',
        'VendorKycSubmission',
        'VendorProfile',
      ]);
    });

    it('marks the tenant root as reachable with a user context alone', () => {
      // Registration inserts a `vendors` row when the vendor does not yet
      // exist. The database still constrains it — the INSERT policy demands
      // `user_id = app.user_id` — so this is a narrower requirement, not an
      // exemption.
      expect(USER_ROOTED_MODELS.has('VendorProfile')).toBe(true);
      expect(USER_ROOTED_MODELS.has('KycDocument')).toBe(false);
      expect(USER_ROOTED_MODELS.has('VendorKycSubmission')).toBe(false);
    });

    it.each(['User', 'RefreshToken', 'Otp', 'MfaSecret', 'MfaChallenge'])(
      'leaves the authentication model %s outside vendor tenancy',
      (model) => {
        // Login happens before any vendor is known. Making these tenant-scoped
        // would make authentication impossible, not safe.
        expect(TENANT_SCOPED_MODELS.has(model)).toBe(false);
      },
    );

    it.each(['Address', 'AuditLog', 'OutboxEvent'])('leaves %s outside vendor tenancy', (model) => {
      expect(TENANT_SCOPED_MODELS.has(model)).toBe(false);
    });
  });
});
