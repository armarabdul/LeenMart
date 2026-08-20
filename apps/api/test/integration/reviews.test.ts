import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { Express } from 'express';
import type { PrismaClient } from '@prisma/client';
import { OTP } from 'otplib';
import { FixedClock, UuidV7Generator } from '@leen-mart/domain-kit';
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
import { Argon2PasswordHasher } from '../../src/modules/identity/infrastructure/security/argon2-password-hasher.js';
import { AesGcmMfaSecretCipher } from '../../src/modules/identity/infrastructure/security/aes-gcm-mfa-secret-cipher.service.js';
import { OtplibTotpService } from '../../src/modules/identity/infrastructure/security/otplib-totp.service.js';
import { PrismaMfaSecretRepository } from '../../src/modules/identity/infrastructure/persistence/prisma-mfa-secret.repository.js';
import { PrismaUserRepository } from '../../src/modules/identity/infrastructure/persistence/prisma-user.repository.js';
import { MfaSecret } from '../../src/modules/identity/domain/entities/mfa-secret.entity.js';
import { User } from '../../src/modules/identity/domain/entities/user.entity.js';
import { Role } from '../../src/modules/identity/domain/value-objects/role.value-object.js';
import { toMfaSecretId } from '../../src/modules/identity/domain/value-objects/mfa-secret-id.value-object.js';
import { toUserId } from '../../src/modules/identity/domain/value-objects/user-id.value-object.js';
import { toSessionId } from '../../src/modules/identity/domain/value-objects/session-id.value-object.js';
import type { RoleName } from '../../src/modules/identity/domain/value-objects/role.value-object.js';
import { NullLogger } from '@leen-mart/domain-kit';
import {
  AdminTransactionRunner,
  PrismaTransactionRunner,
} from '../../src/shared/infrastructure/persistence/tenant-prisma.js';
import { runWithTenant } from '../../src/shared/infrastructure/persistence/tenant-context.js';
import {
  FailingAuditWriter,
  FailingOutboxWriter,
} from '../unit/modules/identity/application/fakes.js';
import { DecideReviewModerationUseCase } from '../../src/modules/review/application/use-cases/decide-review-moderation.use-case.js';
import { PrismaReviewModerationRepository } from '../../src/modules/review/infrastructure/persistence/prisma-review-moderation.repository.js';
import { toReviewId } from '../../src/modules/review/domain/value-objects/review-id.value-object.js';
import { CreateReviewUseCase } from '../../src/modules/review/application/use-cases/create-review.use-case.js';
import { PrismaReviewRepository } from '../../src/modules/review/infrastructure/persistence/prisma-review.repository.js';
import { PrismaVerifiedPurchaseQuery } from '../../src/modules/review/infrastructure/persistence/prisma-verified-purchase-query.js';
import { toOrderItemId } from '../../src/modules/order/index.js';
import { DeliverNotificationUseCase } from '../../src/modules/notification/application/use-cases/deliver-notification.use-case.js';
import { PrismaNotificationWriteRepository } from '../../src/modules/notification/infrastructure/persistence/prisma-notification.repository.js';
import { PrismaNotificationRecipientResolver } from '../../src/modules/notification/infrastructure/persistence/prisma-notification-recipient-resolver.js';

const EMAIL_PREFIX = 'reviews-';
const ADMIN_PASSWORD = 'admin-password-that-is-long-enough';
const ids = new UuidV7Generator();
const now = new FixedClock(new Date('2026-08-21T00:00:00.000Z')).now();

interface ErrorBody {
  readonly error: { code: string };
}
interface CreateProductBody {
  readonly data: { product: { id: string }; variant: { id: string } };
}
interface OrderBody {
  readonly data: {
    id: string;
    subOrders: { id: string; fulfilmentMode: string; items: { id: string }[] }[];
  };
}
interface AddressBody {
  readonly data: { id: string };
}
interface ReviewBody {
  readonly data: { id: string; status: string; rating: number; body: string };
}
interface ListMyReviewsBody {
  readonly data: { id: string; status: string; productId: string }[];
}
interface ProductReviewsBody {
  readonly data: {
    summary: { averageRating: number | null; approvedReviewCount: number };
    items: { id: string; rating: number; body: string }[];
    nextCursor: string | null;
  };
}
interface AdminQueueBody {
  readonly data: { id: string; status: string; customerId: string }[];
}
interface AuthBody {
  readonly data: { accessToken: string };
}
interface ChallengeBody {
  readonly data: { mfaChallengeToken: string };
}
interface PickupTokenBody {
  readonly data: { manualCode: string };
}

/**
 * Verified-purchase product reviews (S8-REVIEWS), end to end: real order
 * placement and fulfilment through to `DELIVERED`/`COMPLETED`, real customer
 * review submission, real admin moderation with real MFA-authenticated
 * `CATALOGUE_MODERATOR`/`SUPER_ADMIN`/`SUPPORT_AGENT`/`RISK_ANALYST`
 * sessions, and real RLS — none of which a mocked verified-purchase
 * relationship could prove. Mirrors `admin-product-decision.test.ts`'s own
 * `adminFor` pattern for admin authentication.
 */
describe('Verified-purchase product reviews (S8-REVIEWS)', () => {
  let harness: IntegrationHarness;
  let app: Express;
  let db: PrismaClient;
  let categoryId: string;
  /** One shared vendor+product — see `deliveredPurchase`'s own comment on why vendor identity is not fresh per test. */
  let sharedSeeded: { vendor: VendorActor; productId: string; variantId: string };
  const seededAdminUserIds: string[] = [];

  const auth = (actor: Actor): string => `Bearer ${actor.token}`;

  const currentTotpCode = async (secret: string): Promise<string> =>
    new OTP({ strategy: 'totp' }).generate({
      secret,
      algorithm: 'sha1',
      digits: 6,
      period: 30,
      epoch: Math.floor(Date.now() / 1000),
    });

  const adminTokens = new Map<string, { token: string; userId: string }>();
  const adminFor = async (role: RoleName): Promise<{ token: string; userId: string }> => {
    const cached = adminTokens.get(role);
    if (cached) return cached;

    const email =
      `${EMAIL_PREFIX}${role.toLowerCase()}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@leenmart.in`.toLowerCase();
    const admin = User.registerAdmin({
      id: toUserId(ids.generate()),
      email,
      passwordHash: await new Argon2PasswordHasher().hash(ADMIN_PASSWORD),
      role: Role.fromName(role),
      now,
    });
    await new PrismaUserRepository(db).create(admin);
    seededAdminUserIds.push(admin.id);

    const secret = new OtplibTotpService().generateSecret();
    await new PrismaMfaSecretRepository(db).create(
      MfaSecret.enroll({
        id: toMfaSecretId(ids.generate()),
        userId: admin.id,
        encryptedSecret: new AesGcmMfaSecretCipher(
          Buffer.from(harness.container.env.MFA_ENCRYPTION_KEY, 'hex'),
        ).encrypt(secret),
        now,
      }).confirm(now),
    );

    const stepOne = await request(app)
      .post('/api/v1/admin/login')
      .send({ email, password: ADMIN_PASSWORD })
      .expect(200);
    const verified = await request(app)
      .post('/api/v1/admin/mfa/verify')
      .send({
        mfaChallengeToken: (stepOne.body as ChallengeBody).data.mfaChallengeToken,
        totpCode: await currentTotpCode(secret),
      })
      .expect(200);

    const entry = { token: (verified.body as AuthBody).data.accessToken, userId: admin.id };
    adminTokens.set(role, entry);
    return entry;
  };

  const VALID_ADDRESS = {
    recipientName: 'Asha Rao',
    phone: '+919876543210',
    line1: '221B Baker Street',
    city: 'Bengaluru',
    state: 'Karnataka',
    pincode: '560001',
    label: 'Home',
  };

  const seedVendor = async (
    label: string,
  ): Promise<{ vendor: VendorActor; productId: string; variantId: string }> => {
    const vendor = await signUpVendorOwner(app, EMAIL_PREFIX, label);
    const createResponse = await request(app)
      .post('/api/v1/vendor/products')
      .set('Authorization', auth(vendor))
      .send({
        categoryId,
        name: `Review Test Product ${randomUUID()}`,
        variant: {
          sku: `REVIEW-${randomUUID()}`,
          name: 'Default',
          price: { amount: '19900', currency: 'INR' },
          unitOfMeasure: 'per piece',
          quantityStep: 1,
        },
      })
      .expect(201);
    const { data } = createResponse.body as CreateProductBody;

    await db.inventory.update({
      where: { variantId: data.variant.id },
      data: { available: 100 },
    });
    await db.product.update({ where: { id: data.product.id }, data: { status: 'APPROVED' } });
    await db.vendorProfile.update({
      where: { id: vendor.vendorId },
      data: { status: 'ACTIVE', shopName: `${label} Shop`, supportsPickup: true },
    });

    return { vendor, productId: data.product.id, variantId: data.variant.id };
  };

  const placeOrder = async (
    customer: Actor,
    seeded: { vendor: VendorActor; variantId: string },
    pickup: boolean,
  ): Promise<{ orderId: string; subOrderId: string; orderItemId: string }> => {
    await request(app)
      .post('/api/v1/me/cart/items')
      .set('Authorization', auth(customer))
      .send({ variantId: seeded.variantId, quantity: 1 })
      .expect(201);
    const addressResponse = await request(app)
      .post('/api/v1/me/addresses')
      .set('Authorization', auth(customer))
      .send(VALID_ADDRESS)
      .expect(201);
    const addressId = (addressResponse.body as AddressBody).data.id;

    const placeResponse = await request(app)
      .post('/api/v1/orders')
      .set('Authorization', auth(customer))
      .set('Idempotency-Key', randomUUID())
      .send({
        addressId,
        paymentMethod: 'ONLINE',
        ...(pickup ? { pickupVendorIds: [seeded.vendor.vendorId] } : {}),
      })
      .expect(201);
    const orderId = (placeResponse.body as OrderBody).data.id;

    await request(app)
      .post(`/api/v1/orders/${orderId}/payment/initiate`)
      .set('Authorization', auth(customer))
      .set('Idempotency-Key', randomUUID())
      .expect(201);
    const confirmed = await request(app)
      .post(`/api/v1/orders/${orderId}/payment/confirm`)
      .set('Authorization', auth(customer))
      .set('Idempotency-Key', randomUUID())
      .send({ testScenario: 'SUCCEEDED' })
      .expect(200);

    const subOrder = (confirmed.body as OrderBody).data.subOrders.find(
      (candidate) => candidate.fulfilmentMode === (pickup ? 'PICKUP' : 'DELIVERY'),
    );
    if (!subOrder) throw new Error('sub-order not found');
    const orderItemId = subOrder.items[0]?.id;
    if (!orderItemId) throw new Error('order item not found');
    return { orderId, subOrderId: subOrder.id, orderItemId };
  };

  /**
   * DELIVERY mode, all the way to `DELIVERED`.
   *
   * `seeded` defaults to one shared vendor+product built once in `beforeAll`
   * — `LOGIN_PER_IP` caps logins at 20/min (the same constraint every sibling
   * suite documents), and `signUpVendorOwner` itself logs in once to pick up
   * its `VENDOR_OWNER` claim. Vendor *identity* is irrelevant to nearly every
   * property this suite checks (verified-purchase ownership, moderation,
   * aggregation) — only the handful of tests that need two distinct products
   * pass their own `seeded`.
   */
  const deliveredPurchase = async (
    label: string,
    seeded: { vendor: VendorActor; productId: string; variantId: string } = sharedSeeded,
  ): Promise<{
    customer: Actor;
    vendor: VendorActor;
    productId: string;
    orderId: string;
    subOrderId: string;
    orderItemId: string;
  }> => {
    const customer = await signUpCustomer(app, EMAIL_PREFIX, `${label}-buyer`);
    const { orderId, subOrderId, orderItemId } = await placeOrder(customer, seeded, false);

    await request(app)
      .post(`/api/v1/vendor/orders/${subOrderId}/process`)
      .set('Authorization', auth(seeded.vendor))
      .expect(200);
    await request(app)
      .post(`/api/v1/vendor/orders/${subOrderId}/ship`)
      .set('Authorization', auth(seeded.vendor))
      .expect(200);
    await request(app)
      .post(`/api/v1/vendor/orders/${subOrderId}/deliver`)
      .set('Authorization', auth(seeded.vendor))
      .expect(200);

    return {
      customer,
      vendor: seeded.vendor,
      productId: seeded.productId,
      orderId,
      subOrderId,
      orderItemId,
    };
  };

  /** PICKUP mode, all the way to `COMPLETED` via the manual code (mirrors `pickup.test.ts`'s own flow). `seeded` defaults to the shared vendor+product — see `deliveredPurchase`'s own comment. */
  const completedPickupPurchase = async (
    label: string,
    seeded: { vendor: VendorActor; productId: string; variantId: string } = sharedSeeded,
  ): Promise<{
    customer: Actor;
    vendor: VendorActor;
    productId: string;
    orderId: string;
    subOrderId: string;
    orderItemId: string;
  }> => {
    const customer = await signUpCustomer(app, EMAIL_PREFIX, `${label}-buyer`);
    const { orderId, subOrderId, orderItemId } = await placeOrder(customer, seeded, true);

    await request(app)
      .post(`/api/v1/vendor/orders/${subOrderId}/process`)
      .set('Authorization', auth(seeded.vendor))
      .expect(200);
    await request(app)
      .post(`/api/v1/vendor/orders/${subOrderId}/ready-for-pickup`)
      .set('Authorization', auth(seeded.vendor))
      .expect(200);

    const tokenResponse = await request(app)
      .get(`/api/v1/orders/${orderId}/sub-orders/${subOrderId}/pickup-token`)
      .set('Authorization', auth(customer))
      .expect(200);
    const manualCode = (tokenResponse.body as PickupTokenBody).data.manualCode;
    await request(app)
      .post(`/api/v1/vendor/orders/${subOrderId}/pickup/manual-complete`)
      .set('Authorization', auth(seeded.vendor))
      .send({ code: manualCode })
      .expect(200);

    return {
      customer,
      vendor: seeded.vendor,
      productId: seeded.productId,
      orderId,
      subOrderId,
      orderItemId,
    };
  };

  const createReview = (
    customer: Actor,
    orderItemId: string,
    rating = 5,
    body = 'Great product, arrived on time.',
  ): request.Test =>
    request(app)
      .post('/api/v1/me/reviews')
      .set('Authorization', auth(customer))
      .send({ orderItemId, rating, body });

  const decideReview = (
    token: string,
    reviewId: string,
    decision: 'APPROVE' | 'HIDE',
  ): request.Test =>
    request(app)
      .post(`/api/v1/admin/reviews/${reviewId}/decision`)
      .set('Authorization', `Bearer ${token}`)
      .send({ decision });

  beforeAll(async () => {
    harness = createIntegrationHarness();
    app = harness.app;
    db = harness.db;
    const slug = `reviews-cat-${Date.now()}`;
    const row = await db.category.create({
      data: { id: randomUUID(), path: [], depth: 1, name: slug, slug },
    });
    categoryId = row.id;
    sharedSeeded = await seedVendor('shared');
  }, 60_000);

  afterAll(async () => {
    await db.mfaChallenge.deleteMany({ where: { userId: { in: seededAdminUserIds } } });
    await db.mfaSecret.deleteMany({ where: { userId: { in: seededAdminUserIds } } });
    await db.refreshToken.deleteMany({ where: { userId: { in: seededAdminUserIds } } });
    // `reviews.customer_id` is RESTRICT against `users` — reviews go before
    // the harness (which removes accounts by email prefix) and before the
    // admin users below (harness only knows the email-prefixed accounts).
    const users = await db.user.findMany({
      where: { email: { contains: EMAIL_PREFIX } },
      select: { id: true },
    });
    // `notifications.recipient_user_id` is RESTRICT against `users` too
    // (S9-NOTIFY-REVIEW's own tests deliver real vendor notifications) — same
    // reason `notification-lifecycle.test.ts`'s own `afterAll` clears this
    // table before the harness removes the accounts.
    await db.notification.deleteMany({
      where: { recipientUserId: { in: users.map((u) => u.id) } },
    });
    await db.review.deleteMany({ where: { customerId: { in: users.map((u) => u.id) } } });
    await db.user.deleteMany({ where: { id: { in: seededAdminUserIds } } });
    await disposeIntegrationHarness(harness, EMAIL_PREFIX);
    await db.$executeRawUnsafe(`DELETE FROM categories WHERE slug LIKE $1`, 'reviews-cat-%');
    await db.$disconnect();
  });

  describe('creating a review', () => {
    it('creates a review for a DELIVERED purchase', async () => {
      const purchase = await deliveredPurchase('delivered-basic');

      const response = await createReview(
        purchase.customer,
        purchase.orderItemId,
        5,
        'Excellent!',
      ).expect(201);

      const body = response.body as ReviewBody;
      expect(body.data.status).toBe('SUBMITTED');
      expect(body.data.rating).toBe(5);
      expect(body.data.body).toBe('Excellent!');

      const row = await db.review.findUniqueOrThrow({ where: { id: body.data.id } });
      expect(row.customerId).toBe(purchase.customer.userId);
      expect(row.productId).toBe(purchase.productId);
      expect(row.orderItemId).toBe(purchase.orderItemId);
    });

    it('creates a review for a COMPLETED (pickup) purchase', async () => {
      const purchase = await completedPickupPurchase('completed-basic');

      const response = await createReview(purchase.customer, purchase.orderItemId).expect(201);

      expect((response.body as ReviewBody).data.status).toBe('SUBMITTED');
    });

    it('rejects a purchase whose sub-order has not reached DELIVERED/COMPLETED', async () => {
      const customer = await signUpCustomer(app, EMAIL_PREFIX, 'notready-buyer');
      const { orderItemId } = await placeOrder(customer, sharedSeeded, false);
      // Deliberately stopped before `/ship`/`/deliver`.

      const response = await createReview(customer, orderItemId).expect(422);
      expect((response.body as ErrorBody).error.code).toBe('PURCHASE_NOT_ELIGIBLE_FOR_REVIEW');

      expect(await db.review.count({ where: { orderItemId } })).toBe(0);
    });

    it('rejects another customer’s order item — cannot review someone else’s purchase', async () => {
      const purchase = await deliveredPurchase('cross-customer');
      const attacker = await signUpCustomer(app, EMAIL_PREFIX, 'attacker');

      const response = await createReview(attacker, purchase.orderItemId).expect(422);
      expect((response.body as ErrorBody).error.code).toBe('PURCHASE_NOT_ELIGIBLE_FOR_REVIEW');

      expect(await db.review.count({ where: { orderItemId: purchase.orderItemId } })).toBe(0);
    });

    it('rejects an order item that does not exist', async () => {
      const customer = await signUpCustomer(app, EMAIL_PREFIX, 'nonexistent-item');

      const response = await createReview(customer, randomUUID()).expect(422);
      expect((response.body as ErrorBody).error.code).toBe('PURCHASE_NOT_ELIGIBLE_FOR_REVIEW');
    });

    it('rejects a rating outside 1–5 at the wire boundary, before any row is written', async () => {
      const purchase = await deliveredPurchase('bad-rating');

      await createReview(purchase.customer, purchase.orderItemId, 6).expect(400);
      await createReview(purchase.customer, purchase.orderItemId, 0).expect(400);

      expect(await db.review.count({ where: { orderItemId: purchase.orderItemId } })).toBe(0);
    });

    it('rejects a duplicate review for the same purchase — the database constraint, not just an application check', async () => {
      const purchase = await deliveredPurchase('duplicate');
      await createReview(purchase.customer, purchase.orderItemId).expect(201);

      const response = await createReview(purchase.customer, purchase.orderItemId).expect(409);
      expect((response.body as ErrorBody).error.code).toBe('REVIEW_ALREADY_EXISTS');

      expect(await db.review.count({ where: { orderItemId: purchase.orderItemId } })).toBe(1);
    });

    it('under real concurrent submission, exactly one of two simultaneous reviews for the same purchase wins', async () => {
      const purchase = await deliveredPurchase('concurrent');

      const results = await Promise.allSettled([
        createReview(purchase.customer, purchase.orderItemId, 4, 'First attempt'),
        createReview(purchase.customer, purchase.orderItemId, 2, 'Second attempt'),
      ]);
      const statuses = results
        .map((result) => (result.status === 'fulfilled' ? result.value.status : 0))
        .sort((a, b) => a - b);

      expect(statuses).toEqual([201, 409]);
      expect(await db.review.count({ where: { orderItemId: purchase.orderItemId } })).toBe(1);
    });
  });

  describe('listing my own reviews', () => {
    it('shows the caller their own review regardless of moderation status, and never another customer’s', async () => {
      const mine = await deliveredPurchase('list-mine');
      const other = await deliveredPurchase('list-other');
      await createReview(mine.customer, mine.orderItemId).expect(201);
      await createReview(other.customer, other.orderItemId).expect(201);

      const response = await request(app)
        .get('/api/v1/me/reviews')
        .set('Authorization', auth(mine.customer))
        .expect(200);

      const items = (response.body as ListMyReviewsBody).data;
      expect(items).toHaveLength(1);
      expect(items[0]?.productId).toBe(mine.productId);
    });

    it('refuses an unauthenticated caller', async () => {
      await request(app).get('/api/v1/me/reviews').expect(401);
      await request(app).post('/api/v1/me/reviews').send({}).expect(401);
    });
  });

  describe('public product review listing and rating summary', () => {
    it('never shows a SUBMITTED review, and reports a null average / zero count for it', async () => {
      // A dedicated product, not `sharedSeeded` — this asserts an *exact*
      // count (zero), which must not be polluted by another test's approved
      // review on the same product.
      const purchase = await deliveredPurchase(
        'public-submitted',
        await seedVendor('public-submitted'),
      );
      await createReview(purchase.customer, purchase.orderItemId).expect(201);

      const response = await request(app)
        .get(`/api/v1/catalogue/products/${purchase.productId}/reviews`)
        .expect(200);

      const body = (response.body as ProductReviewsBody).data;
      expect(body.items).toHaveLength(0);
      expect(body.summary).toEqual({ averageRating: null, approvedReviewCount: 0 });
    });

    it('shows an APPROVED review publicly, and its rating counts in the summary', async () => {
      // Dedicated product — see the previous test's own comment.
      const purchase = await deliveredPurchase(
        'public-approved',
        await seedVendor('public-approved'),
      );
      const created = await createReview(purchase.customer, purchase.orderItemId, 4, 'Good value');
      const reviewId = (created.body as ReviewBody).data.id;
      const { token } = await adminFor('CATALOGUE_MODERATOR');
      await decideReview(token, reviewId, 'APPROVE').expect(200);

      const response = await request(app)
        .get(`/api/v1/catalogue/products/${purchase.productId}/reviews`)
        .expect(200);

      const body = (response.body as ProductReviewsBody).data;
      expect(body.items).toHaveLength(1);
      expect(body.items[0]?.rating).toBe(4);
      expect(body.items[0]?.body).toBe('Good value');
      expect(body.summary).toEqual({ averageRating: 4, approvedReviewCount: 1 });
    });

    it('computes a simple average across multiple approved reviews, and excludes a HIDDEN one from both the list and the average', async () => {
      const seeded = await seedVendor('public-avg');
      const buyerA = await signUpCustomer(app, EMAIL_PREFIX, 'avg-a');
      const buyerB = await signUpCustomer(app, EMAIL_PREFIX, 'avg-b');
      const buyerC = await signUpCustomer(app, EMAIL_PREFIX, 'avg-c');
      const { token } = await adminFor('CATALOGUE_MODERATOR');

      const reviewIds: string[] = [];
      for (const [customer, rating] of [
        [buyerA, 5],
        [buyerB, 3],
        [buyerC, 1],
      ] as const) {
        const { orderItemId, subOrderId } = await placeOrder(customer, seeded, false);
        await request(app)
          .post(`/api/v1/vendor/orders/${subOrderId}/process`)
          .set('Authorization', auth(seeded.vendor))
          .expect(200);
        await request(app)
          .post(`/api/v1/vendor/orders/${subOrderId}/ship`)
          .set('Authorization', auth(seeded.vendor))
          .expect(200);
        await request(app)
          .post(`/api/v1/vendor/orders/${subOrderId}/deliver`)
          .set('Authorization', auth(seeded.vendor))
          .expect(200);

        const created = await createReview(customer, orderItemId, rating).expect(201);
        const reviewId = (created.body as ReviewBody).data.id;
        await decideReview(token, reviewId, 'APPROVE').expect(200);
        reviewIds.push(reviewId);
      }

      // Hide the third (rating 1) — the average of the remaining two (5, 3) is 4.
      await decideReview(token, reviewIds[2] ?? '', 'HIDE').expect(200);

      const response = await request(app)
        .get(`/api/v1/catalogue/products/${seeded.productId}/reviews`)
        .expect(200);

      const body = (response.body as ProductReviewsBody).data;
      expect(body.items).toHaveLength(2);
      expect(body.summary).toEqual({ averageRating: 4, approvedReviewCount: 2 });
    });

    it('never mixes one product’s reviews into another product’s listing', async () => {
      const purchaseA = await deliveredPurchase('isolation-a', await seedVendor('isolation-a'));
      const purchaseB = await deliveredPurchase('isolation-b', await seedVendor('isolation-b'));
      const { token } = await adminFor('CATALOGUE_MODERATOR');

      const reviewA = await createReview(
        purchaseA.customer,
        purchaseA.orderItemId,
        5,
        'Product A review',
      );
      await decideReview(token, (reviewA.body as ReviewBody).data.id, 'APPROVE').expect(200);
      const reviewB = await createReview(
        purchaseB.customer,
        purchaseB.orderItemId,
        1,
        'Product B review',
      );
      await decideReview(token, (reviewB.body as ReviewBody).data.id, 'APPROVE').expect(200);

      const responseA = await request(app)
        .get(`/api/v1/catalogue/products/${purchaseA.productId}/reviews`)
        .expect(200);

      const bodyA = (responseA.body as ProductReviewsBody).data;
      expect(bodyA.items).toHaveLength(1);
      expect(bodyA.items[0]?.body).toBe('Product A review');
    });
  });

  describe('moderation', () => {
    it('CATALOGUE_MODERATOR sees a SUBMITTED review in the queue', async () => {
      const purchase = await deliveredPurchase('queue-visible');
      const created = await createReview(purchase.customer, purchase.orderItemId).expect(201);
      const { token } = await adminFor('CATALOGUE_MODERATOR');

      const response = await request(app)
        .get('/api/v1/admin/reviews')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      const items = (response.body as AdminQueueBody).data;
      expect(items.some((item) => item.id === (created.body as ReviewBody).data.id)).toBe(true);
    });

    it('APPROVE then HIDE then APPROVE again (restoring visibility) — the full locked V1 transition set', async () => {
      const purchase = await deliveredPurchase('full-transitions');
      const created = await createReview(purchase.customer, purchase.orderItemId).expect(201);
      const reviewId = (created.body as ReviewBody).data.id;
      const { token } = await adminFor('CATALOGUE_MODERATOR');

      const approved = await decideReview(token, reviewId, 'APPROVE').expect(200);
      expect((approved.body as ReviewBody).data.status).toBe('APPROVED');

      const hidden = await decideReview(token, reviewId, 'HIDE').expect(200);
      expect((hidden.body as ReviewBody).data.status).toBe('HIDDEN');

      const restored = await decideReview(token, reviewId, 'APPROVE').expect(200);
      expect((restored.body as ReviewBody).data.status).toBe('APPROVED');
    });

    it('rolls the decision back when the audit write fails — no status change survives', async () => {
      // The moderation decision and its audit row share one transaction
      // (SDD 8.2: every admin action is audited). If the audit cannot be
      // written the decision must not stand, the same invariant
      // `admin-product-decision.test.ts` holds for product moderation.
      const purchase = await deliveredPurchase('audit-rollback');
      const created = await createReview(purchase.customer, purchase.orderItemId).expect(201);
      const reviewId = (created.body as ReviewBody).data.id;

      const useCase = new DecideReviewModerationUseCase({
        reviewModerationRepository: new PrismaReviewModerationRepository(
          harness.container.adminPrisma,
        ),
        transactionRunner: new AdminTransactionRunner(harness.container.adminPrisma),
        auditWriter: new FailingAuditWriter(),
        clock: new FixedClock(now),
        logger: new NullLogger(),
      });

      const { userId } = await adminFor('CATALOGUE_MODERATOR');
      await expect(
        useCase.execute({
          principal: {
            userId: toUserId(userId),
            sessionId: toSessionId(randomUUID()),
            role: 'CATALOGUE_MODERATOR',
          },
          reviewId: toReviewId(reviewId),
          decision: 'APPROVE',
        }),
      ).rejects.toThrow();

      // Still SUBMITTED: the rollback took the status change with it.
      const row = await db.review.findUniqueOrThrow({ where: { id: reviewId } });
      expect(row.status).toBe('SUBMITTED');
    });

    it('refuses an illegal transition — approving an already-APPROVED review', async () => {
      const purchase = await deliveredPurchase('illegal-transition');
      const created = await createReview(purchase.customer, purchase.orderItemId).expect(201);
      const reviewId = (created.body as ReviewBody).data.id;
      const { token } = await adminFor('CATALOGUE_MODERATOR');
      await decideReview(token, reviewId, 'APPROVE').expect(200);

      const response = await decideReview(token, reviewId, 'APPROVE').expect(422);
      expect((response.body as ErrorBody).error.code).toBe('INVALID_REVIEW_MODERATION_TRANSITION');
    });

    it.each(['SUPPORT_AGENT', 'RISK_ANALYST'] as RoleName[])(
      '%s can read the queue but cannot decide (read-only per the permission matrix)',
      async (role) => {
        const purchase = await deliveredPurchase(`readonly-${role.toLowerCase()}`);
        const created = await createReview(purchase.customer, purchase.orderItemId).expect(201);
        const { token } = await adminFor(role);

        await request(app)
          .get('/api/v1/admin/reviews')
          .set('Authorization', `Bearer ${token}`)
          .expect(200);

        // `requirePermission`'s own refusal is `UnauthorizedError`, which is
        // a `ForbiddenError` (403) — the caller is authenticated, just not
        // permitted, unlike the true-401 cases in "listing my own reviews"
        // above where there is no principal at all.
        await decideReview(token, (created.body as ReviewBody).data.id, 'APPROVE').expect(403);
      },
    );

    it('refuses a customer token entirely — no moderation access', async () => {
      const purchase = await deliveredPurchase('customer-cannot-moderate');
      const created = await createReview(purchase.customer, purchase.orderItemId).expect(201);

      await request(app)
        .get('/api/v1/admin/reviews')
        .set('Authorization', auth(purchase.customer))
        .expect(403);
      await request(app)
        .post(`/api/v1/admin/reviews/${(created.body as ReviewBody).data.id}/decision`)
        .set('Authorization', auth(purchase.customer))
        .send({ decision: 'APPROVE' })
        .expect(403);
    });

    it('refuses a vendor token entirely — no moderation access', async () => {
      const purchase = await deliveredPurchase('vendor-cannot-moderate');

      await request(app)
        .get('/api/v1/admin/reviews')
        .set('Authorization', auth(purchase.vendor))
        .expect(403);
    });

    it('under real concurrent moderation, exactly one of two simultaneous decisions on the same review wins', async () => {
      const purchase = await deliveredPurchase('concurrent-moderation');
      const created = await createReview(purchase.customer, purchase.orderItemId).expect(201);
      const reviewId = (created.body as ReviewBody).data.id;
      const { token } = await adminFor('CATALOGUE_MODERATOR');

      // Deliberately the *same* decision twice, not APPROVE+HIDE — the
      // locked V1 transition set allows both SUBMITTED->APPROVED->HIDDEN and
      // SUBMITTED->HIDDEN->APPROVED, so an APPROVE/HIDE pair would legally
      // succeed in either order and prove nothing about the race. Two
      // simultaneous APPROVEs can only ever have one winner.
      const results = await Promise.allSettled([
        decideReview(token, reviewId, 'APPROVE'),
        decideReview(token, reviewId, 'APPROVE'),
      ]);
      const statuses = results
        .map((result) => (result.status === 'fulfilled' ? result.value.status : 0))
        .sort((a, b) => a - b);

      // The loser's exact status depends on exactly how the two requests
      // interleave — two genuinely-overlapping reads (both see `SUBMITTED`)
      // are caught by the database's conditional `UPDATE` (409, mirroring
      // `ProductAlreadyDecidedError`'s own race); a loser whose read happens
      // after the winner's commit sees `APPROVED` already and is refused one
      // layer earlier, by the domain's own illegal-transition guard (422).
      // Both are "you lost the race" — a single winner is the invariant this
      // asserts, not which layer caught the loser.
      expect(statuses[0]).toBe(200);
      expect([409, 422]).toContain(statuses[1]);
      const row = await db.review.findUniqueOrThrow({ where: { id: reviewId } });
      expect(row.status).toBe('APPROVED');
    });
  });

  /**
   * Vendor notification on review submission (S9-NOTIFY-REVIEW).
   *
   * The orchestrator here is the **real** `DeliverNotificationUseCase` on the
   * **real** `checkoutPrisma` credential, driven from the **real** outbox row
   * a genuine `POST /me/reviews` call produced — the same "drives the real
   * orchestrator exactly as the worker does" pattern
   * `notification-lifecycle.test.ts` already establishes, just fed from an
   * actual database row instead of a fabricated payload, so the properties
   * under test include the payload `CreateReviewUseCase` actually writes, not
   * one this file invents.
   */
  describe('vendor notification on review submission (S9-NOTIFY-REVIEW)', () => {
    let orchestrator: DeliverNotificationUseCase;

    beforeAll(() => {
      orchestrator = new DeliverNotificationUseCase({
        repository: new PrismaNotificationWriteRepository(
          harness.container.checkoutPrisma,
          ids,
          new FixedClock(now),
        ),
        recipients: new PrismaNotificationRecipientResolver(harness.container.checkoutPrisma),
        logger: new NullLogger(),
      });
    });

    interface OutboxRow {
      readonly id: string;
      readonly eventType: string;
      readonly payload: Record<string, unknown>;
    }

    const outboxRowFor = async (reviewId: string): Promise<OutboxRow> => {
      const row = await db.outboxEvent.findFirst({
        where: { aggregateType: 'Review', aggregateId: reviewId, eventType: 'review.received' },
      });
      if (!row) throw new Error(`no review.received outbox row for review ${reviewId}`);
      return {
        id: row.id,
        eventType: row.eventType,
        payload: row.payload as Record<string, unknown>,
      };
    };

    const deliver = (row: OutboxRow): ReturnType<DeliverNotificationUseCase['execute']> =>
      orchestrator.execute({
        outboxEventId: row.id,
        eventType: row.eventType,
        payload: row.payload,
      });

    const inboxOf = async (
      userId: string,
    ): Promise<
      {
        eventType: string;
        recipientKind: string;
        title: string;
        body: string;
        outboxEventId: string;
      }[]
    > =>
      (await db.notification.findMany({
        where: { recipientUserId: userId },
        select: {
          eventType: true,
          recipientKind: true,
          title: true,
          body: true,
          outboxEventId: true,
        },
      })) as {
        eventType: string;
        recipientKind: string;
        title: string;
        body: string;
        outboxEventId: string;
      }[];

    it('submits a valid verified review, persists it as SUBMITTED, and writes exactly one review.received outbox event naming the product and the vendor', async () => {
      const purchase = await deliveredPurchase('notify-basic');

      const created = await createReview(
        purchase.customer,
        purchase.orderItemId,
        5,
        'Loved it',
      ).expect(201);
      const body = created.body as ReviewBody;
      expect(body.data.status).toBe('SUBMITTED');

      const rows = await db.outboxEvent.findMany({
        where: { aggregateType: 'Review', aggregateId: body.data.id },
      });
      expect(rows).toHaveLength(1);
      expect(rows[0]?.eventType).toBe('review.received');
      expect(rows[0]?.payload).toMatchObject({
        productId: purchase.productId,
        vendorId: purchase.vendor.vendorId,
      });
      // Never the customer, never the review's own text.
      expect(rows[0]?.payload).not.toHaveProperty('customerId');
      expect(rows[0]?.payload).not.toHaveProperty('body');
    });

    it('the worker delivers exactly one VENDOR notification to the reviewed product’s vendor', async () => {
      const purchase = await deliveredPurchase('notify-deliver');
      const created = await createReview(purchase.customer, purchase.orderItemId).expect(201);
      const row = await outboxRowFor((created.body as ReviewBody).data.id);

      const result = await deliver(row);

      expect(result).toMatchObject({ created: 1, recipients: 1 });
      const delivered = (await inboxOf(purchase.vendor.userId)).filter(
        (entry) => entry.outboxEventId === row.id,
      );
      expect(delivered).toHaveLength(1);
      expect(delivered[0]).toMatchObject({ eventType: 'review.received', recipientKind: 'VENDOR' });
    });

    it('redelivering the same review.received event stays idempotent — one notification row, not two', async () => {
      const purchase = await deliveredPurchase('notify-redeliver');
      const created = await createReview(purchase.customer, purchase.orderItemId).expect(201);
      const row = await outboxRowFor((created.body as ReviewBody).data.id);

      const first = await deliver(row);
      const second = await deliver(row);

      expect(first).toMatchObject({ created: 1 });
      expect(second).toMatchObject({ created: 0, alreadyPresent: 1 });
      expect(await db.notification.count({ where: { outboxEventId: row.id } })).toBe(1);
    });

    it('Vendor A receives Vendor A’s review notification', async () => {
      const seededA = await seedVendor('notify-vendor-a');
      const purchase = await deliveredPurchase('notify-vendor-a', seededA);
      const created = await createReview(purchase.customer, purchase.orderItemId).expect(201);
      const row = await outboxRowFor((created.body as ReviewBody).data.id);

      await deliver(row);

      const delivered = (await inboxOf(seededA.vendor.userId)).some(
        (entry) => entry.outboxEventId === row.id,
      );
      expect(delivered).toBe(true);
    });

    it('Vendor B never receives Vendor A’s review notification', async () => {
      const seededA = await seedVendor('notify-isolation-a');
      const seededB = await seedVendor('notify-isolation-b');
      const purchase = await deliveredPurchase('notify-isolation-a', seededA);
      const before = await inboxOf(seededB.vendor.userId);

      const created = await createReview(purchase.customer, purchase.orderItemId).expect(201);
      const row = await outboxRowFor((created.body as ReviewBody).data.id);
      await deliver(row);

      expect(await inboxOf(seededB.vendor.userId)).toHaveLength(before.length);
    });

    it('the reviewing customer’s own CUSTOMER inbox is unaffected by their own review', async () => {
      const purchase = await deliveredPurchase('notify-customer-unaffected');
      const before = await inboxOf(purchase.customer.userId);

      const created = await createReview(purchase.customer, purchase.orderItemId).expect(201);
      const row = await outboxRowFor((created.body as ReviewBody).data.id);
      await deliver(row);

      expect(await inboxOf(purchase.customer.userId)).toHaveLength(before.length);
    });

    it('the delivered notification names only the product — no review body, no rating figure, no customer identity', async () => {
      const purchase = await deliveredPurchase('notify-content');
      const created = await createReview(
        purchase.customer,
        purchase.orderItemId,
        5,
        'The secret sauce recipe is honestly not that great',
      ).expect(201);
      const row = await outboxRowFor((created.body as ReviewBody).data.id);

      await deliver(row);

      const delivered = (await inboxOf(purchase.vendor.userId)).find(
        (entry) => entry.outboxEventId === row.id,
      );
      expect(delivered).toBeDefined();
      const text = `${delivered?.title} ${delivered?.body}`;
      expect(text.toLowerCase()).not.toContain('secret sauce');
      expect(text).not.toContain(purchase.customer.userId);
      expect(text.replace(purchase.productId.slice(-8).toUpperCase(), '')).not.toMatch(/\d/);
    });

    it('a duplicate review submission retains S8’s existing 409 error and produces no second outbox event', async () => {
      const purchase = await deliveredPurchase('notify-duplicate');
      const first = await createReview(purchase.customer, purchase.orderItemId).expect(201);
      const reviewId = (first.body as ReviewBody).data.id;

      const second = await createReview(purchase.customer, purchase.orderItemId).expect(409);
      expect((second.body as ErrorBody).error.code).toBe('REVIEW_ALREADY_EXISTS');

      const rows = await db.outboxEvent.findMany({
        where: { aggregateType: 'Review', aggregateId: reviewId },
      });
      expect(rows).toHaveLength(1);
    });

    it('a failed transaction leaves neither the review nor its outbox event behind', async () => {
      // Forces the outbox write — the step *after* the review insert, inside
      // the same transaction — to fail, so a genuine Postgres rollback has to
      // undo an already-executed INSERT, not merely skip a step that was
      // never reached. Mirrors `FailingAuditWriter`'s own moderation-rollback
      // test above.
      // A dedicated product, not `sharedSeeded` — the assertion below counts
      // outbox rows by product id, which must not be polluted by every other
      // test in this file that already reviewed the shared product.
      const purchase = await deliveredPurchase(
        'notify-rollback',
        await seedVendor('notify-rollback'),
      );
      const useCase = new CreateReviewUseCase({
        verifiedPurchaseQuery: new PrismaVerifiedPurchaseQuery(harness.container.checkoutPrisma),
        reviewRepository: new PrismaReviewRepository(harness.container.prisma),
        transactionRunner: new PrismaTransactionRunner(harness.container.prisma),
        outboxWriter: new FailingOutboxWriter(),
        idGenerator: ids,
        clock: new FixedClock(now),
        logger: new NullLogger(),
      });

      await expect(
        runWithTenant({ userId: toUserId(purchase.customer.userId), vendorId: null }, () =>
          useCase.execute({
            principal: {
              userId: toUserId(purchase.customer.userId),
              sessionId: toSessionId(randomUUID()),
              role: 'CUSTOMER',
            },
            orderItemId: toOrderItemId(purchase.orderItemId),
            rating: 5,
            body: 'Should not survive the rollback',
          }),
        ),
      ).rejects.toThrow();

      expect(await db.review.count({ where: { orderItemId: purchase.orderItemId } })).toBe(0);
      expect(
        await db.outboxEvent.count({
          where: {
            aggregateType: 'Review',
            eventType: 'review.received',
            payload: { path: ['productId'], equals: purchase.productId },
          },
        }),
      ).toBe(0);
    });

    it('existing review moderation still works, and moderation itself writes no outbox event of its own', async () => {
      const purchase = await deliveredPurchase('notify-moderation-unaffected');
      const created = await createReview(purchase.customer, purchase.orderItemId).expect(201);
      const reviewId = (created.body as ReviewBody).data.id;
      const { token } = await adminFor('CATALOGUE_MODERATOR');

      const approved = await decideReview(token, reviewId, 'APPROVE').expect(200);
      expect((approved.body as ReviewBody).data.status).toBe('APPROVED');

      // Still just the one row from submission — moderation is a separate,
      // deliberately un-notified surface (S9's own locked scope).
      const rows = await db.outboxEvent.findMany({
        where: { aggregateType: 'Review', aggregateId: reviewId },
      });
      expect(rows).toHaveLength(1);
      expect(rows[0]?.eventType).toBe('review.received');
    });
  });
});
