import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { Express } from 'express';
import type { PrismaClient } from '@prisma/client';
import { NullLogger, UuidV7Generator } from '@leen-mart/domain-kit';
import {
  createIntegrationHarness,
  disposeIntegrationHarness,
  type IntegrationHarness,
} from '../support/integration-app.js';
import {
  signUpCustomer,
  signUpVendorOwner,
  type Actor,
  type VendorActor,
} from '../support/actors.js';
import { AmbientAuditWriter } from '../../src/modules/audit/index.js';
import { PrismaAuditLogRepository } from '../../src/modules/audit/infrastructure/persistence/prisma-audit-log.repository.js';
import { DecideProductUseCase } from '../../src/modules/catalogue/application/use-cases/decide-product.use-case.js';
import { PrismaProductRepository } from '../../src/modules/catalogue/infrastructure/persistence/prisma-product.repository.js';
import { PrismaProductMediaRepository } from '../../src/modules/catalogue/infrastructure/persistence/prisma-product-media.repository.js';
import { AdminTransactionRunner } from '../../src/shared/infrastructure/persistence/tenant-prisma.js';
import { toProductId } from '../../src/modules/catalogue/domain/value-objects/product-id.value-object.js';
import { toSessionId } from '../../src/modules/identity/domain/value-objects/session-id.value-object.js';
import { toUserId } from '../../src/modules/identity/domain/value-objects/user-id.value-object.js';
import type { Principal } from '../../src/modules/identity/application/ports/principal.js';

const EMAIL_PREFIX = 'cart-';
const ids = new UuidV7Generator();

interface CreateProductBody {
  readonly data: { product: { id: string } };
}
interface CartItemBody {
  readonly id: string;
  readonly variantId: string;
  readonly quantity: number;
}
interface CartBody {
  readonly data: { id: string | null; items: CartItemBody[] };
}
interface ErrorBody {
  readonly error: { code: string };
}

const statusesOf = (results: PromiseSettledResult<request.Response>[]): number[] =>
  results
    .map((result) => (result.status === 'fulfilled' ? result.value.status : 0))
    .sort((a, b) => a - b);

describe('cart', () => {
  let harness: IntegrationHarness;
  let app: Express;
  let db: PrismaClient;
  let vendor: VendorActor;
  let categoryId: string;

  const auth = (actor: Actor): string => `Bearer ${actor.token}`;

  /**
   * Extracts the id of a cart response's sole/first item as a guaranteed
   * `string` — mirrors `route-manifest.ts`'s `seedCartItem` helper (find,
   * throw if absent) rather than an inline `items[0]?.id`, which types as
   * `string | undefined` under `exactOptionalPropertyTypes` and cannot be
   * passed to a Prisma `where` clause.
   */
  const firstItemId = (response: request.Response): string => {
    const item = (response.body as CartBody).data.items[0];
    if (!item) throw new Error('firstItemId: response contained no items');
    return item.id;
  };

  /**
   * Creates an `APPROVED`, non-deleted product with one variant and the
   * requested stock — the exact shape S3-1's `leenmart_public` RLS policies
   * gate cart eligibility on. Goes through S2-8's real approval gate (a
   * `READY` media item is required for `DecideProductUseCase` to reach
   * `APPROVED` at all), the same shortcut
   * `vendor-product-media-concurrency.test.ts` already establishes for
   * reaching `APPROVED` without the admin MFA flow.
   */
  const seedApprovedVariant = async (
    quantityStep = 1,
    available = 100,
  ): Promise<{ productId: string; variantId: string }> => {
    const createResponse = await request(app)
      .post('/api/v1/vendor/products')
      .set('Authorization', auth(vendor))
      .send({
        categoryId,
        name: `Cart Product ${randomUUID()}`,
        variant: {
          sku: `CART-${Date.now()}-${randomUUID()}`,
          name: 'Default',
          price: { amount: '10000', currency: 'INR' },
          unitOfMeasure: 'per piece',
          quantityStep,
        },
      })
      .expect(201);
    const productId = (createResponse.body as CreateProductBody).data.product.id;
    const variantRow = await db.productVariant.findFirstOrThrow({ where: { productId } });

    await db.inventory.update({ where: { variantId: variantRow.id }, data: { available } });

    await request(app)
      .post(`/api/v1/vendor/products/${productId}/submit`)
      .set('Authorization', auth(vendor))
      .expect(200);

    // S2-8's approval gate: at least one live READY media item.
    await db.productMedia.create({
      data: {
        id: randomUUID(),
        productId,
        vendorId: vendor.vendorId,
        objectKey: `product-media/${vendor.vendorId}/${productId}/${randomUUID()}.jpg`,
        contentType: 'image/jpeg',
        sizeBytes: 1024,
        status: 'READY',
      },
    });

    const decideProductUseCase = new DecideProductUseCase({
      productRepository: new PrismaProductRepository(harness.container.adminPrisma),
      productMediaRepository: new PrismaProductMediaRepository(harness.container.adminPrisma),
      transactionRunner: new AdminTransactionRunner(harness.container.adminPrisma),
      auditWriter: new AmbientAuditWriter({
        auditLogRepository: new PrismaAuditLogRepository(harness.container.adminPrisma),
        idGenerator: harness.container.idGenerator,
        clock: harness.container.clock,
      }),
      clock: harness.container.clock,
      logger: new NullLogger(),
    });
    const principal: Principal = {
      userId: toUserId(ids.generate()),
      sessionId: toSessionId(ids.generate()),
      role: 'CATALOGUE_MODERATOR',
    };
    await decideProductUseCase.execute({
      principal,
      productId: toProductId(productId),
      command: { decision: 'APPROVE' },
    });

    return { productId, variantId: variantRow.id };
  };

  beforeAll(async () => {
    harness = createIntegrationHarness();
    app = harness.app;
    db = harness.db;
    vendor = await signUpVendorOwner(app, EMAIL_PREFIX, 'vendor');
    const slug = `cart-cat-${Date.now()}`;
    const row = await db.category.create({
      data: { id: randomUUID(), path: [], depth: 1, name: slug, slug },
    });
    categoryId = row.id;
  }, 60_000);

  afterAll(async () => {
    await disposeIntegrationHarness(harness, EMAIL_PREFIX);
    await db.$executeRawUnsafe(`DELETE FROM categories WHERE slug LIKE $1`, 'cart-cat-%');
    await db.$disconnect();
  });

  describe('GET /api/v1/me/cart', () => {
    it('returns an empty cart without creating one when the caller has never added anything', async () => {
      const customer = await signUpCustomer(app, EMAIL_PREFIX, 'get-empty');

      const response = await request(app)
        .get('/api/v1/me/cart')
        .set('Authorization', auth(customer))
        .expect(200);

      expect((response.body as CartBody).data).toEqual({ id: null, items: [] });
      expect(await db.cart.findUnique({ where: { userId: customer.userId } })).toBeNull();
    });
  });

  describe('POST /api/v1/me/cart/items', () => {
    it('adds an eligible item and creates the cart on first use', async () => {
      const customer = await signUpCustomer(app, EMAIL_PREFIX, 'add-basic');
      const { variantId } = await seedApprovedVariant();

      const response = await request(app)
        .post('/api/v1/me/cart/items')
        .set('Authorization', auth(customer))
        .send({ variantId, quantity: 3 })
        .expect(201);

      const body = (response.body as CartBody).data;
      expect(body.id).not.toBeNull();
      expect(body.items).toHaveLength(1);
      expect(body.items[0]).toMatchObject({ variantId, quantity: 3 });
    });

    it('increments the existing item instead of creating a duplicate row', async () => {
      const customer = await signUpCustomer(app, EMAIL_PREFIX, 'add-increment');
      const { variantId } = await seedApprovedVariant();

      await request(app)
        .post('/api/v1/me/cart/items')
        .set('Authorization', auth(customer))
        .send({ variantId, quantity: 2 })
        .expect(201);
      const second = await request(app)
        .post('/api/v1/me/cart/items')
        .set('Authorization', auth(customer))
        .send({ variantId, quantity: 3 })
        .expect(201);

      const body = (second.body as CartBody).data;
      expect(body.items).toHaveLength(1);
      expect(body.items[0]?.quantity).toBe(5);
    });

    it('rejects a variant that never reached APPROVED (still DRAFT)', async () => {
      const customer = await signUpCustomer(app, EMAIL_PREFIX, 'add-draft');
      const createResponse = await request(app)
        .post('/api/v1/vendor/products')
        .set('Authorization', auth(vendor))
        .send({
          categoryId,
          name: `Draft Product ${randomUUID()}`,
          variant: {
            sku: `DRAFT-${Date.now()}-${randomUUID()}`,
            name: 'Default',
            price: { amount: '10000', currency: 'INR' },
            unitOfMeasure: 'per piece',
            quantityStep: 1,
          },
        })
        .expect(201);
      const productId = (createResponse.body as CreateProductBody).data.product.id;
      const variantRow = await db.productVariant.findFirstOrThrow({ where: { productId } });

      const response = await request(app)
        .post('/api/v1/me/cart/items')
        .set('Authorization', auth(customer))
        .send({ variantId: variantRow.id, quantity: 1 })
        .expect(422);

      expect((response.body as ErrorBody).error.code).toBe('PRODUCT_NOT_ELIGIBLE_FOR_CART');
    });

    it('rejects a variant id that does not exist at all', async () => {
      const customer = await signUpCustomer(app, EMAIL_PREFIX, 'add-missing');

      const response = await request(app)
        .post('/api/v1/me/cart/items')
        .set('Authorization', auth(customer))
        .send({ variantId: randomUUID(), quantity: 1 })
        .expect(422);

      expect((response.body as ErrorBody).error.code).toBe('PRODUCT_NOT_ELIGIBLE_FOR_CART');
    });

    it('rejects a quantity exceeding available stock', async () => {
      const customer = await signUpCustomer(app, EMAIL_PREFIX, 'add-oversell');
      const { variantId } = await seedApprovedVariant(1, 2);

      const response = await request(app)
        .post('/api/v1/me/cart/items')
        .set('Authorization', auth(customer))
        .send({ variantId, quantity: 3 })
        .expect(422);

      expect((response.body as ErrorBody).error.code).toBe('INSUFFICIENT_INVENTORY');
    });

    it('rejects a quantity that is not a multiple of the variant quantityStep', async () => {
      const customer = await signUpCustomer(app, EMAIL_PREFIX, 'add-step');
      const { variantId } = await seedApprovedVariant(250, 1000);

      const response = await request(app)
        .post('/api/v1/me/cart/items')
        .set('Authorization', auth(customer))
        .send({ variantId, quantity: 100 })
        .expect(422);

      expect((response.body as ErrorBody).error.code).toBe('INVALID_CART_QUANTITY');
    });

    it('rejects a non-positive quantity at the contract layer (400, before any use case runs)', async () => {
      const customer = await signUpCustomer(app, EMAIL_PREFIX, 'add-zero');
      const { variantId } = await seedApprovedVariant();

      await request(app)
        .post('/api/v1/me/cart/items')
        .set('Authorization', auth(customer))
        .send({ variantId, quantity: 0 })
        .expect(400);
    });

    it('never ends up with two live rows for the same variant under concurrent adds', async () => {
      const customer = await signUpCustomer(app, EMAIL_PREFIX, 'add-race');
      const { variantId } = await seedApprovedVariant();

      const add = (): request.Test =>
        request(app)
          .post('/api/v1/me/cart/items')
          .set('Authorization', auth(customer))
          .send({ variantId, quantity: 1 });

      // Both requests may read "no existing item for this variant" before
      // either writes. Two outcomes are both correct depending on how the
      // two requests actually interleave: `uq_cart_items_cart_variant`
      // rejects the loser of a genuine race with a 409 (the same "database
      // decides who wins" shape MAX_IMAGES_PER_PRODUCT's own concurrency
      // test establishes), or — if the first commits before the second's
      // read — the second legitimately sees the existing row and increments
      // it, both succeeding at 201. Either way there is exactly one live row
      // afterwards with the combined quantity; that invariant, not one
      // specific interleaving, is what this asserts.
      const results = await Promise.allSettled([add(), add()]);
      const statuses = statusesOf(results);
      expect(statuses.every((status) => status === 201 || status === 409)).toBe(true);
      expect(statuses).toContain(201);

      const rows = await db.cartItem.findMany({
        where: { variantId, deletedAt: null, cart: { userId: customer.userId } },
      });
      expect(rows).toHaveLength(1);
      expect(rows[0]?.quantity).toBe(statuses.filter((status) => status === 201).length);
    });
  });

  describe('PATCH /api/v1/me/cart/items/:itemId', () => {
    it('sets an absolute new quantity', async () => {
      const customer = await signUpCustomer(app, EMAIL_PREFIX, 'update-basic');
      const { variantId } = await seedApprovedVariant();
      const addResponse = await request(app)
        .post('/api/v1/me/cart/items')
        .set('Authorization', auth(customer))
        .send({ variantId, quantity: 2 })
        .expect(201);
      const itemId = firstItemId(addResponse);

      const response = await request(app)
        .patch(`/api/v1/me/cart/items/${itemId}`)
        .set('Authorization', auth(customer))
        .send({ quantity: 7 })
        .expect(200);

      expect((response.body as CartBody).data.items[0]).toMatchObject({ quantity: 7 });
    });

    it('rejects a quantity exceeding availability on re-check', async () => {
      const customer = await signUpCustomer(app, EMAIL_PREFIX, 'update-oversell');
      const { variantId } = await seedApprovedVariant(1, 5);
      const addResponse = await request(app)
        .post('/api/v1/me/cart/items')
        .set('Authorization', auth(customer))
        .send({ variantId, quantity: 2 })
        .expect(201);
      const itemId = firstItemId(addResponse);

      const response = await request(app)
        .patch(`/api/v1/me/cart/items/${itemId}`)
        .set('Authorization', auth(customer))
        .send({ quantity: 6 })
        .expect(422);

      expect((response.body as ErrorBody).error.code).toBe('INSUFFICIENT_INVENTORY');
    });

    it('404s for an item that belongs to a different customer', async () => {
      const owner = await signUpCustomer(app, EMAIL_PREFIX, 'update-owner');
      const attacker = await signUpCustomer(app, EMAIL_PREFIX, 'update-attacker');
      const { variantId } = await seedApprovedVariant();
      const addResponse = await request(app)
        .post('/api/v1/me/cart/items')
        .set('Authorization', auth(owner))
        .send({ variantId, quantity: 1 })
        .expect(201);
      const itemId = firstItemId(addResponse);

      await request(app)
        .patch(`/api/v1/me/cart/items/${itemId}`)
        .set('Authorization', auth(attacker))
        .send({ quantity: 5 })
        .expect(404);

      const unchanged = await db.cartItem.findUnique({ where: { id: itemId } });
      expect(unchanged?.quantity).toBe(1);
    });

    it('404s for an item id that never existed', async () => {
      const customer = await signUpCustomer(app, EMAIL_PREFIX, 'update-missing');

      await request(app)
        .patch(`/api/v1/me/cart/items/${randomUUID()}`)
        .set('Authorization', auth(customer))
        .send({ quantity: 1 })
        .expect(404);
    });
  });

  describe('DELETE /api/v1/me/cart/items/:itemId', () => {
    it('removes an owned item', async () => {
      const customer = await signUpCustomer(app, EMAIL_PREFIX, 'remove-basic');
      const { variantId } = await seedApprovedVariant();
      const addResponse = await request(app)
        .post('/api/v1/me/cart/items')
        .set('Authorization', auth(customer))
        .send({ variantId, quantity: 1 })
        .expect(201);
      const itemId = firstItemId(addResponse);

      await request(app)
        .delete(`/api/v1/me/cart/items/${itemId}`)
        .set('Authorization', auth(customer))
        .expect(200);

      const getResponse = await request(app)
        .get('/api/v1/me/cart')
        .set('Authorization', auth(customer))
        .expect(200);
      expect((getResponse.body as CartBody).data.items).toHaveLength(0);
    });

    it('404s for an item that belongs to a different customer and leaves it untouched', async () => {
      const owner = await signUpCustomer(app, EMAIL_PREFIX, 'remove-owner');
      const attacker = await signUpCustomer(app, EMAIL_PREFIX, 'remove-attacker');
      const { variantId } = await seedApprovedVariant();
      const addResponse = await request(app)
        .post('/api/v1/me/cart/items')
        .set('Authorization', auth(owner))
        .send({ variantId, quantity: 1 })
        .expect(201);
      const itemId = firstItemId(addResponse);

      await request(app)
        .delete(`/api/v1/me/cart/items/${itemId}`)
        .set('Authorization', auth(attacker))
        .expect(404);

      expect(await db.cartItem.findUnique({ where: { id: itemId } })).not.toBeNull();
    });
  });

  describe('DELETE /api/v1/me/cart', () => {
    it("clears every item in the caller's own cart", async () => {
      const customer = await signUpCustomer(app, EMAIL_PREFIX, 'clear-basic');
      const { variantId: variantA } = await seedApprovedVariant();
      const { variantId: variantB } = await seedApprovedVariant();
      await request(app)
        .post('/api/v1/me/cart/items')
        .set('Authorization', auth(customer))
        .send({ variantId: variantA, quantity: 1 })
        .expect(201);
      await request(app)
        .post('/api/v1/me/cart/items')
        .set('Authorization', auth(customer))
        .send({ variantId: variantB, quantity: 1 })
        .expect(201);

      await request(app).delete('/api/v1/me/cart').set('Authorization', auth(customer)).expect(200);

      const getResponse = await request(app)
        .get('/api/v1/me/cart')
        .set('Authorization', auth(customer))
        .expect(200);
      expect((getResponse.body as CartBody).data.items).toHaveLength(0);
    });

    it('is a no-op (200) for a customer with no cart yet', async () => {
      const customer = await signUpCustomer(app, EMAIL_PREFIX, 'clear-empty');

      await request(app).delete('/api/v1/me/cart').set('Authorization', auth(customer)).expect(200);
    });
  });

  describe('cross-customer isolation', () => {
    it("one customer's cart never appears in another's", async () => {
      const customerA = await signUpCustomer(app, EMAIL_PREFIX, 'isolation-a');
      const customerB = await signUpCustomer(app, EMAIL_PREFIX, 'isolation-b');
      const { variantId } = await seedApprovedVariant();

      await request(app)
        .post('/api/v1/me/cart/items')
        .set('Authorization', auth(customerA))
        .send({ variantId, quantity: 4 })
        .expect(201);

      const bResponse = await request(app)
        .get('/api/v1/me/cart')
        .set('Authorization', auth(customerB))
        .expect(200);
      expect((bResponse.body as CartBody).data).toEqual({ id: null, items: [] });
    });
  });
});
