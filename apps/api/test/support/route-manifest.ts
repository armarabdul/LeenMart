import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { Express } from 'express';
import type { PrismaClient } from '@prisma/client';
import { signUpCustomer, signUpVendorOwner, type Actor, type VendorActor } from './actors.js';

/**
 * What kind of route this is, for the purpose of SDD 6.6 layer 2.
 *
 * Only `TENANT_OWNED` is exercised by the matrix. Every other value is an
 * **exclusion**, and each one carries a written justification in the entry —
 * so a route is never quietly left out, and a reviewer sees the reasoning in
 * the diff rather than having to reconstruct it.
 */
export type RouteClassification =
  /** Names someone else's resource by id in the path. Must answer 404, never 403 or 200. */
  | 'TENANT_OWNED'
  /** Scoped entirely to the authenticated principal; no id to substitute, so nothing to cross. */
  | 'SELF_SCOPED'
  /** Reads or writes across tenants *by design* — asserting isolation here would assert a bug. */
  | 'ADMIN'
  /** No authentication at all. */
  | 'PUBLIC'
  /** Runs before any tenant exists (registration, login, refresh, OTP). */
  | 'PRE_TENANT';

export type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'DELETE';

/** Everything a `TENANT_OWNED` entry needs to drive itself. */
export interface RouteTestContext {
  readonly app: Express;
  readonly db: PrismaClient;
}

interface BaseRoute {
  readonly method: HttpMethod;
  /**
   * The mount prefix, **declared rather than discovered**. Express 5 does not
   * expose it: a mounted router's `Layer` carries `path === undefined` and its
   * `matchers` are compiled closures with no readable source pattern (Express
   * 4's `regexp` was removed). See `mountedRoutes()` in the matrix test.
   */
  readonly prefix: string;
  /** The sub-path exactly as the router registers it, which is what introspection returns. */
  readonly path: string;
  /** Why this classification, in one line. Required on every entry. */
  readonly why: string;
}

export interface ExcludedRoute extends BaseRoute {
  readonly classification: Exclude<RouteClassification, 'TENANT_OWNED'>;
}

export interface TenantOwnedRoute extends BaseRoute {
  readonly classification: 'TENANT_OWNED';
  /**
   * Mints one principal who can own this route's resource.
   *
   * Defaults to a plain customer. Vendor-owned resources (S2-3b) override it
   * with `signUpVendorOwner`, because a customer token carries neither the
   * `CREATE_OR_EDIT_PRODUCT` grant nor a vendor for `tenantContext` to
   * resolve — the isolation proof has to be run by principals who could
   * genuinely reach the route.
   */
  readonly actor?: (ctx: RouteTestContext, label: string) => Promise<Actor>;
  /** Creates a resource owned by `owner` and returns its id. */
  readonly seed: (ctx: RouteTestContext, owner: Actor) => Promise<string>;
  /** Builds the request in which `actor` names `resourceId` — the attack itself. */
  readonly attempt: (ctx: RouteTestContext, actor: Actor, resourceId: string) => request.Test;
  /**
   * Reads the victim's stored row so a refused write can be proved to have
   * changed nothing. `undefined` for read-only routes, where there is no
   * write to disprove.
   */
  readonly snapshot?: (ctx: RouteTestContext, resourceId: string) => Promise<unknown>;
}

export type ManifestRoute = ExcludedRoute | TenantOwnedRoute;

const VALID_ADDRESS = {
  recipientName: 'Asha Rao',
  phone: '+919876543210',
  line1: '221B Baker Street',
  city: 'Bengaluru',
  state: 'Karnataka',
  pincode: '560001',
  label: 'Home',
};

const authed = (test: request.Test, actor: Actor): request.Test =>
  test.set('Authorization', `Bearer ${actor.token}`);

/** Creates one address owned by `owner` through the real endpoint, and returns its id. */
const seedAddress = async (ctx: RouteTestContext, owner: Actor): Promise<string> => {
  const response = await authed(request(ctx.app).post('/api/v1/me/addresses'), owner)
    .send(VALID_ADDRESS)
    .expect(201);
  return (response.body as { data: { id: string } }).data.id;
};

/** The whole stored row — so an unchanged-check catches a soft delete, a field edit or a default flip alike. */
const snapshotAddress = (ctx: RouteTestContext, resourceId: string): Promise<unknown> =>
  ctx.db.address.findUnique({ where: { id: resourceId } });

// --- vendor products (S2-3b) -------------------------------------------------

const VENDOR_EMAIL_PREFIX = 'cross-tenant-matrix-';

/**
 * The matrix's principals for product routes: real vendors, not customers.
 *
 * **Memoised per label**, so the whole matrix runs on one attacker and one
 * victim. `LOGIN_PER_IP` caps logins at 20/min and each vendor costs one, so
 * minting a fresh pair for every proof would rate-limit the suite into
 * failure — the same reason the admin suites cache a token per role.
 *
 * It costs the proof nothing: what has to be fresh is the *resource* under
 * attack, which `seedProduct`/`seedVariant` still create per test. "Vendor A
 * cannot reach vendor B's product" is exactly as strong when A and B are the
 * same two vendors throughout.
 */
const vendorActors = new Map<string, VendorActor>();
const vendorActor = async (ctx: RouteTestContext, label: string): Promise<VendorActor> => {
  const cached = vendorActors.get(label);
  if (cached) return cached;
  // Awaited before caching, so a failed mint is retried rather than turned
  // into a permanently cached rejection.
  const minted = await signUpVendorOwner(ctx.app, VENDOR_EMAIL_PREFIX, label);
  vendorActors.set(label, minted);
  return minted;
};

/**
 * `vendorActor`, additionally activated (S3-5). The matrix's own `twoOwners()`
 * mints *both* the resource owner and the attacker through whichever `actor`
 * function a route supplies — so for the vendor-order routes, which refuse
 * any non-ACTIVE vendor before ownership is ever checked
 * (`requireActiveVendor`), a plain `vendorActor` attacker would be refused
 * with `VENDOR_NOT_ACTIVE` (422) rather than reach the RLS/ownership check
 * the matrix is actually proving — a false failure, not a real isolation
 * gap. Every vendor-order manifest entry uses this instead of the bare
 * `vendorActor` so both the owner and the attacker clear that gate the same
 * way a real ACTIVE vendor would.
 */
const activeVendorActor = async (ctx: RouteTestContext, label: string): Promise<VendorActor> => {
  const actor = await vendorActor(ctx, label);
  await ctx.db.vendorProfile.update({ where: { id: actor.vendorId }, data: { status: 'ACTIVE' } });
  return actor;
};

let productSeq = 0;

/** A category to hang the seeded products off. Platform-owned, so one is enough for the whole suite. */
const seedCategoryRow = async (ctx: RouteTestContext): Promise<string> => {
  const slug = `matrix-products-${Date.now()}-${(productSeq += 1)}`;
  const row = await ctx.db.category.create({
    data: { id: randomUUID(), path: [], depth: 1, name: slug, slug },
  });
  return row.id;
};

/** Creates one product (and its mandatory first variant) owned by `owner`. */
const seedProduct = async (ctx: RouteTestContext, owner: Actor): Promise<string> => {
  const categoryId = await seedCategoryRow(ctx);
  const response = await authed(request(ctx.app).post('/api/v1/vendor/products'), owner)
    .send({
      categoryId,
      name: `Matrix Product ${(productSeq += 1)}`,
      variant: {
        sku: `MATRIX-${Date.now()}-${productSeq}`,
        name: 'Default',
        price: { amount: '19900', currency: 'INR' },
        unitOfMeasure: 'per piece',
        quantityStep: 1,
      },
    })
    .expect(201);
  return (response.body as { data: { product: { id: string } } }).data.product.id;
};

/**
 * Seeds a product and returns `productId/variantId`.
 *
 * A variant is addressed by **both** ids, but the matrix's contract carries
 * exactly one opaque string per resource. Encoding the pair keeps that
 * contract intact and — more importantly — keeps the isolation proof honest:
 * addressing the variant with its own id in the product slot would 404 for
 * the wrong reason (no such product), and the test would pass without ever
 * exercising the boundary it claims to.
 */
const seedVariant = async (ctx: RouteTestContext, owner: Actor): Promise<string> => {
  const productId = await seedProduct(ctx, owner);
  const row = await ctx.db.productVariant.findFirstOrThrow({ where: { productId } });
  return `${productId}/${row.id}`;
};

/**
 * Splits a seeded `productId/variantId` back into a URL suffix.
 *
 * The matrix also feeds this a bare random uuid for its "never existed" case;
 * using it for both segments then is correct — the request is well-formed,
 * reaches the handler, and 404s because nothing matches.
 */
const variantPath = (resourceId: string): string => {
  const [productId, variantId] = resourceId.includes('/')
    ? resourceId.split('/')
    : [resourceId, resourceId];
  return `${productId}/variants/${variantId}`;
};

/** The variant half of a seeded pair, for the unchanged-check. */
const variantIdOf = (resourceId: string): string => resourceId.split('/').at(-1) ?? resourceId;

const snapshotProduct = (ctx: RouteTestContext, resourceId: string): Promise<unknown> =>
  ctx.db.product.findUnique({ where: { id: resourceId } });

const snapshotVariant = (ctx: RouteTestContext, resourceId: string): Promise<unknown> =>
  ctx.db.productVariant.findUnique({ where: { id: variantIdOf(resourceId) } });

const snapshotInventory = (ctx: RouteTestContext, resourceId: string): Promise<unknown> =>
  ctx.db.inventory.findUnique({ where: { variantId: variantIdOf(resourceId) } });

/**
 * Seeds a product and one `AWAITING_UPLOAD` media row under it (S2-6a),
 * returning `productId/mediaId` — same encoding `seedVariant` uses, for the
 * same reason (`mediaPath` below is `variantPath`'s sibling).
 *
 * A bare upload-intent is enough: the routes under attack here
 * (`complete`/`remove`) only need a row to exist under someone else's
 * product, not a completed upload.
 */
const seedMedia = async (ctx: RouteTestContext, owner: Actor): Promise<string> => {
  const productId = await seedProduct(ctx, owner);
  const response = await authed(
    request(ctx.app).post(`/api/v1/vendor/products/${productId}/media`),
    owner,
  )
    .send({ contentType: 'image/jpeg', sizeBytes: 512 })
    .expect(201);
  const mediaId = (response.body as { data: { mediaId: string } }).data.mediaId;
  return `${productId}/${mediaId}`;
};

const mediaPath = (resourceId: string): string => {
  const [productId, mediaId] = resourceId.includes('/')
    ? resourceId.split('/')
    : [resourceId, resourceId];
  return `${productId}/media/${mediaId}`;
};

const mediaIdOf = (resourceId: string): string => resourceId.split('/').at(-1) ?? resourceId;

const snapshotMedia = (ctx: RouteTestContext, resourceId: string): Promise<unknown> =>
  ctx.db.productMedia.findUnique({ where: { id: mediaIdOf(resourceId) } });

// --- cart (S3-1) --------------------------------------------------------

/**
 * Seeds a fresh `APPROVED` product+variant with stock (so it is visible
 * under `leenmart_public` and passes the availability check — S3-1's
 * eligibility gate) and one cart item owned by `owner`, returning the
 * item's id.
 */
const seedCartItem = async (ctx: RouteTestContext, owner: Actor): Promise<string> => {
  const categoryId = await seedCategoryRow(ctx);
  const vendor = await vendorActor(ctx, 'cart-matrix-vendor');
  const createResponse = await authed(request(ctx.app).post('/api/v1/vendor/products'), vendor)
    .send({
      categoryId,
      name: `Cart Matrix Product ${(productSeq += 1)}`,
      variant: {
        sku: `CART-MATRIX-${Date.now()}-${productSeq}`,
        name: 'Default',
        price: { amount: '19900', currency: 'INR' },
        unitOfMeasure: 'per piece',
        quantityStep: 1,
      },
    })
    .expect(201);
  const productId = (createResponse.body as { data: { product: { id: string } } }).data.product.id;
  const variantRow = await ctx.db.productVariant.findFirstOrThrow({ where: { productId } });

  await ctx.db.inventory.update({ where: { variantId: variantRow.id }, data: { available: 100 } });
  await ctx.db.product.update({ where: { id: productId }, data: { status: 'APPROVED' } });

  const response = await authed(request(ctx.app).post('/api/v1/me/cart/items'), owner)
    .send({ variantId: variantRow.id, quantity: 1 })
    .expect(201);
  const item = (
    response.body as { data: { items: { id: string; variantId: string }[] } }
  ).data.items.find((row) => row.variantId === variantRow.id);
  if (!item) throw new Error('seedCartItem: item not found in response after add');
  return item.id;
};

// --- orders (S3-3A) ------------------------------------------------------

/**
 * Seeds one real, placed order owned by `owner` — a fresh `ACTIVE` vendor
 * with a `shopName` set (S3-3A decisions D-S3-03/D-S3-04), an `APPROVED`
 * product with stock, a saved address, and a genuine `POST /orders` call —
 * then returns the order's id.
 *
 * Vendor activation has no HTTP path a test can reach (it requires a real
 * KYC decision first, which `requireFullAccess` limits to
 * RISK_ANALYST/SUPER_ADMIN — out of scope for what this matrix is proving),
 * so `status`/`shopName` are set directly via `ctx.db`, the same convention
 * `seedCartItem` already uses for `product.status`/`inventory.available`.
 */
const seedOrder = async (ctx: RouteTestContext, owner: Actor): Promise<string> => {
  const categoryId = await seedCategoryRow(ctx);
  const vendor = await vendorActor(ctx, 'order-matrix-vendor');
  const createResponse = await authed(request(ctx.app).post('/api/v1/vendor/products'), vendor)
    .send({
      categoryId,
      name: `Order Matrix Product ${(productSeq += 1)}`,
      variant: {
        sku: `ORDER-MATRIX-${Date.now()}-${productSeq}`,
        name: 'Default',
        price: { amount: '19900', currency: 'INR' },
        unitOfMeasure: 'per piece',
        quantityStep: 1,
      },
    })
    .expect(201);
  const productId = (createResponse.body as { data: { product: { id: string } } }).data.product.id;
  const variantRow = await ctx.db.productVariant.findFirstOrThrow({ where: { productId } });

  await ctx.db.inventory.update({ where: { variantId: variantRow.id }, data: { available: 100 } });
  await ctx.db.product.update({ where: { id: productId }, data: { status: 'APPROVED' } });
  await ctx.db.vendorProfile.update({
    where: { id: vendor.vendorId },
    data: { status: 'ACTIVE', shopName: 'Order Matrix Shop' },
  });

  await authed(request(ctx.app).post('/api/v1/me/cart/items'), owner)
    .send({ variantId: variantRow.id, quantity: 1 })
    .expect(201);

  const addressResponse = await authed(request(ctx.app).post('/api/v1/me/addresses'), owner)
    .send(VALID_ADDRESS)
    .expect(201);
  const addressId = (addressResponse.body as { data: { id: string } }).data.id;

  const placeResponse = await authed(request(ctx.app).post('/api/v1/orders'), owner)
    .set('Idempotency-Key', `matrix-${randomUUID()}`)
    .send({ addressId, paymentMethod: 'ONLINE' })
    .expect(201);
  return (placeResponse.body as { data: { id: string } }).data.id;
};

/** The whole stored row, including its sub-orders — a refused cancel must leave every level unchanged. */
const snapshotOrder = (ctx: RouteTestContext, resourceId: string): Promise<unknown> =>
  ctx.db.order.findUnique({ where: { id: resourceId }, include: { subOrders: true } });

/** The whole stored row — the matrix always addresses an item by its own id, never a `cartId`. */
const snapshotCartItem = (ctx: RouteTestContext, resourceId: string): Promise<unknown> =>
  ctx.db.cartItem.findUnique({ where: { id: resourceId } });

// --- vendor orders (S3-5) -------------------------------------------------

/**
 * Seeds one real sub-order owned by `owner` (a vendor, minted via
 * `vendorActor`) and returns the **sub-order's own id** — never the parent
 * order id, matching S3-5's locked decision to address vendor-order
 * resources by `SubOrderId` throughout.
 *
 * `owner` is typed `Actor` (the shared `TenantOwnedRoute.seed` signature)
 * but is always a `VendorActor` at runtime for these two routes (both
 * override `actor: vendorActor` below) — `owner.vendorId` is deliberately
 * never read here; the vendor's own `VendorProfile` row is looked up by
 * `userId` instead, which every `Actor` already carries, so no cast is
 * needed.
 */
const seedVendorSubOrder = async (ctx: RouteTestContext, owner: Actor): Promise<string> => {
  const categoryId = await seedCategoryRow(ctx);
  const vendorProfile = await ctx.db.vendorProfile.findFirstOrThrow({
    where: { userId: owner.userId },
  });
  const customer = await signUpCustomer(
    ctx.app,
    VENDOR_EMAIL_PREFIX,
    `vendor-order-customer-${Date.now()}-${(productSeq += 1)}`,
  );

  const createResponse = await authed(request(ctx.app).post('/api/v1/vendor/products'), owner)
    .send({
      categoryId,
      name: `Vendor Order Matrix Product ${(productSeq += 1)}`,
      variant: {
        sku: `VENDOR-ORDER-MATRIX-${Date.now()}-${productSeq}`,
        name: 'Default',
        price: { amount: '19900', currency: 'INR' },
        unitOfMeasure: 'per piece',
        quantityStep: 1,
      },
    })
    .expect(201);
  const productId = (createResponse.body as { data: { product: { id: string } } }).data.product.id;
  const variantRow = await ctx.db.productVariant.findFirstOrThrow({ where: { productId } });

  await ctx.db.inventory.update({ where: { variantId: variantRow.id }, data: { available: 100 } });
  await ctx.db.product.update({ where: { id: productId }, data: { status: 'APPROVED' } });
  await ctx.db.vendorProfile.update({
    where: { id: vendorProfile.id },
    data: { status: 'ACTIVE', shopName: 'Vendor Order Matrix Shop' },
  });

  await authed(request(ctx.app).post('/api/v1/me/cart/items'), customer)
    .send({ variantId: variantRow.id, quantity: 1 })
    .expect(201);

  const addressResponse = await authed(request(ctx.app).post('/api/v1/me/addresses'), customer)
    .send(VALID_ADDRESS)
    .expect(201);
  const addressId = (addressResponse.body as { data: { id: string } }).data.id;

  const placeResponse = await authed(request(ctx.app).post('/api/v1/orders'), customer)
    .set('Idempotency-Key', `matrix-${randomUUID()}`)
    .send({ addressId, paymentMethod: 'ONLINE' })
    .expect(201);
  const orderId = (placeResponse.body as { data: { id: string } }).data.id;
  const subOrderRow = await ctx.db.subOrder.findFirstOrThrow({ where: { orderId } });
  return subOrderRow.id;
};

/** The whole stored row — a refused read/write must be provable to have changed nothing. */
const snapshotVendorSubOrder = (ctx: RouteTestContext, resourceId: string): Promise<unknown> =>
  ctx.db.subOrder.findUnique({ where: { id: resourceId } });

/**
 * Every route the application actually mounts, classified.
 *
 * This is the "route table" SDD 6.6 layer 2 is generated from. It is declared
 * rather than reflected because Express 5 gives no way to recover a mount
 * prefix (see `BaseRoute.prefix`); the completeness guard in the matrix test
 * reconciles it against the live router in both directions, so the manifest
 * cannot drift from reality without a test failing.
 *
 * Ordered by mount, matching `app.ts`.
 */
export const ROUTE_MANIFEST: readonly ManifestRoute[] = [
  // --- health (mounted at the root) ---
  {
    method: 'GET',
    prefix: '',
    path: '/healthz',
    classification: 'PUBLIC',
    why: 'Liveness probe, unauthenticated and tenant-free (SDD 9.4).',
  },
  {
    method: 'GET',
    prefix: '',
    path: '/readyz',
    classification: 'PUBLIC',
    why: 'Readiness probe, unauthenticated and tenant-free (SDD 9.4).',
  },

  // --- identity: /api/v1/identity ---
  {
    method: 'POST',
    prefix: '/api/v1/identity',
    path: '/register',
    classification: 'PRE_TENANT',
    why: 'Creates the account; no principal exists yet to cross a boundary from.',
  },
  {
    method: 'POST',
    prefix: '/api/v1/identity',
    path: '/login',
    classification: 'PRE_TENANT',
    why: 'Authentication itself — runs before any tenant is known (SDD 7.1).',
  },
  {
    method: 'POST',
    prefix: '/api/v1/identity',
    path: '/refresh',
    classification: 'PRE_TENANT',
    why: 'Rotates a refresh token presented as a credential; owns no addressable resource.',
  },
  {
    method: 'POST',
    prefix: '/api/v1/identity',
    path: '/logout',
    classification: 'PRE_TENANT',
    why: 'Revokes the presented session only; takes no resource id.',
  },
  {
    method: 'POST',
    prefix: '/api/v1/identity',
    path: '/otp/request',
    classification: 'PRE_TENANT',
    why: 'Pre-authentication challenge (SDD 7.3); no principal, no tenant.',
  },
  {
    method: 'POST',
    prefix: '/api/v1/identity',
    path: '/otp/verify',
    classification: 'PRE_TENANT',
    why: 'Pre-authentication challenge (SDD 7.3); no principal, no tenant.',
  },
  {
    method: 'GET',
    prefix: '/api/v1/identity',
    path: '/me',
    classification: 'SELF_SCOPED',
    why: 'Returns the caller’s own principal; there is no id to substitute.',
  },

  // --- admin auth: /api/v1/admin ---
  {
    method: 'POST',
    prefix: '/api/v1/admin',
    path: '/login',
    classification: 'PRE_TENANT',
    why: 'Admin step-one authentication; no principal yet.',
  },
  {
    method: 'POST',
    prefix: '/api/v1/admin',
    path: '/mfa/verify',
    classification: 'PRE_TENANT',
    why: 'Admin step-two authentication against a challenge token; no tenant.',
  },
  {
    method: 'POST',
    prefix: '/api/v1/admin',
    path: '/mfa/enroll',
    classification: 'ADMIN',
    why: 'Enrols the calling admin’s own factor; admins are not tenants.',
  },
  {
    method: 'POST',
    prefix: '/api/v1/admin',
    path: '/mfa/enroll/confirm',
    classification: 'ADMIN',
    why: 'Confirms the calling admin’s own factor; admins are not tenants.',
  },

  // --- vendor: /api/v1/vendors ---
  {
    method: 'POST',
    prefix: '/api/v1/vendors',
    path: '/',
    classification: 'SELF_SCOPED',
    why: 'Registration *creates* the tenant; there is no other vendor’s resource to name.',
  },
  {
    method: 'POST',
    prefix: '/api/v1/vendors',
    path: '/me/kyc/documents',
    classification: 'SELF_SCOPED',
    why: 'Object keys derive from the caller’s own vendor id; the cross-tenant attack is a body replay, hand-tested in vendor-kyc-submission.test.ts (RD6).',
  },
  {
    method: 'POST',
    prefix: '/api/v1/vendors',
    path: '/me/kyc',
    classification: 'SELF_SCOPED',
    why: 'Submits against the caller’s own vendor; the cross-tenant attack is a body replay, hand-tested in vendor-kyc-submission.test.ts (RD6).',
  },
  {
    method: 'PATCH',
    prefix: '/api/v1/vendors',
    path: '/me/shop-profile',
    classification: 'SELF_SCOPED',
    why: 'Sets the shop name on the caller’s own vendor profile (S3-3A, D-S3-03); there is no vendor id in the request to swap for another owner’s.',
  },

  // --- admin KYC: /api/v1/admin/kyc ---
  {
    method: 'GET',
    prefix: '/api/v1/admin/kyc',
    path: '/submissions',
    classification: 'ADMIN',
    why: 'The review queue is cross-tenant by design (KYC-5 Commit 2).',
  },
  {
    method: 'GET',
    prefix: '/api/v1/admin/kyc',
    path: '/submissions/:kycId',
    classification: 'ADMIN',
    why: 'Admin detail read across every vendor, on the elevated credential.',
  },
  {
    method: 'GET',
    prefix: '/api/v1/admin/kyc',
    path: '/submissions/:kycId/documents/:documentId',
    classification: 'ADMIN',
    why: 'Admin document access across every vendor (KYC-7); role denial is covered there.',
  },
  {
    method: 'POST',
    prefix: '/api/v1/admin/kyc',
    path: '/submissions/:kycId/review',
    classification: 'ADMIN',
    why: 'Admin claim across every vendor (KYC-5 Commit 3).',
  },
  {
    method: 'POST',
    prefix: '/api/v1/admin/kyc',
    path: '/submissions/:kycId/decision',
    classification: 'ADMIN',
    why: 'Admin decision across every vendor (KYC-5 Commit 3).',
  },
  {
    method: 'POST',
    prefix: '/api/v1/admin/kyc',
    path: '/vendors/:vendorId/activate',
    classification: 'ADMIN',
    why: 'Admin-only vendor activation across every vendor (S3-3A, D-S3-04) — same permission/access-level gate as the KYC decision route above.',
  },

  // --- admin taxonomy: /api/v1/admin/categories (S2-2a) ---
  //
  // Every route here is ADMIN rather than TENANT_OWNED, and for a stronger
  // reason than the KYC admin surface: categories are platform-owned and carry
  // no vendor column at all, so there is no tenant boundary for one admin to
  // cross into another's data. `MANAGE_CATEGORIES_OR_COMMISSION` plus
  // `requireFullAccess` is the whole of the authorisation story, and the role
  // matrix for it is asserted directly in admin-category.test.ts.
  {
    method: 'GET',
    prefix: '/api/v1/admin/categories',
    path: '/',
    classification: 'ADMIN',
    why: 'Platform-owned taxonomy list; no tenant column exists to scope by.',
  },
  {
    method: 'GET',
    prefix: '/api/v1/admin/categories',
    path: '/:categoryId',
    classification: 'ADMIN',
    why: 'Platform-owned taxonomy detail; the id names a category, not a tenant’s resource.',
  },
  {
    method: 'POST',
    prefix: '/api/v1/admin/categories',
    path: '/',
    classification: 'ADMIN',
    why: 'Creates a platform-owned category; FULL-access admins only.',
  },
  {
    method: 'PATCH',
    prefix: '/api/v1/admin/categories',
    path: '/:categoryId',
    classification: 'ADMIN',
    why: 'Edits a platform-owned category; FULL-access admins only.',
  },
  {
    method: 'POST',
    prefix: '/api/v1/admin/categories',
    path: '/:categoryId/parent',
    classification: 'ADMIN',
    why: 'Moves a platform-owned subtree; FULL-access admins only.',
  },
  {
    method: 'DELETE',
    prefix: '/api/v1/admin/categories',
    path: '/:categoryId',
    classification: 'ADMIN',
    why: 'Soft-deletes a platform-owned category; FULL-access admins only.',
  },

  // Per-category attribute definitions (S2-2b). Mounted on the same router as
  // the categories above and ADMIN for the same reason: an attribute belongs to
  // a platform-owned category and carries no vendor column either.
  {
    method: 'GET',
    prefix: '/api/v1/admin/categories',
    path: '/:categoryId/attributes',
    classification: 'ADMIN',
    why: 'Lists one platform-owned category’s attribute definitions.',
  },
  {
    method: 'GET',
    prefix: '/api/v1/admin/categories',
    path: '/:categoryId/attributes/:attributeId',
    classification: 'ADMIN',
    why: 'Reads one platform-owned attribute definition; scoped by both ids.',
  },
  {
    method: 'POST',
    prefix: '/api/v1/admin/categories',
    path: '/:categoryId/attributes',
    classification: 'ADMIN',
    why: 'Defines a new attribute on a platform-owned category; FULL-access admins only.',
  },
  {
    method: 'PATCH',
    prefix: '/api/v1/admin/categories',
    path: '/:categoryId/attributes/:attributeId',
    classification: 'ADMIN',
    why: 'Edits a platform-owned attribute definition; FULL-access admins only.',
  },
  {
    method: 'DELETE',
    prefix: '/api/v1/admin/categories',
    path: '/:categoryId/attributes/:attributeId',
    classification: 'ADMIN',
    why: 'Soft-deletes a platform-owned attribute definition; FULL-access admins only.',
  },

  // --- public catalogue: /api/v1/catalogue (S2-2c) ---
  // Unauthenticated and tenant-free, same as `/healthz`/`/readyz` above and for
  // the same underlying reason `/api/v1/admin/categories` above is ADMIN
  // rather than TENANT_OWNED: categories are platform-owned, carry no tenant
  // column, and the S2-2a migration's own comment already requires this
  // surface to read them with no tenant context at all.
  {
    method: 'GET',
    prefix: '/api/v1/catalogue',
    path: '/categories',
    classification: 'PUBLIC',
    why: 'Unauthenticated public category tree; platform-owned, no tenant to cross.',
  },
  {
    method: 'GET',
    prefix: '/api/v1/catalogue',
    path: '/categories/:slug',
    classification: 'PUBLIC',
    why: 'Unauthenticated public category detail by slug; platform-owned, no tenant to cross.',
  },

  // --- public product detail: /api/v1/catalogue/products/:id (S3-3 discovery milestone) ---
  // Unauthenticated and tenant-free for the same underlying reason
  // `/api/v1/search` above is PUBLIC: `products_public_read` (S2-7) and
  // `product_variants_public_read`/`inventory_public_read` (S3-1) are what
  // confine this route to APPROVED, non-deleted rows on `leenmart_public` —
  // not a tenant boundary this manifest's TENANT_OWNED matrix would need to
  // drive, since there is no vendor-scoped notion of "wrong owner" here at all.
  {
    method: 'GET',
    prefix: '/api/v1/catalogue',
    path: '/products/:id',
    classification: 'PUBLIC',
    why: 'Unauthenticated public product detail; RLS on leenmart_public (products_public_read/product_variants_public_read/inventory_public_read) confines results to APPROVED, non-deleted rows regardless of tenant.',
  },

  // --- vendor products: /api/v1/vendor/products (S2-3b) ---
  //
  // The catalogue module's first tenant-scoped routes, and the first
  // TENANT_OWNED entries in this manifest that are owned by a *vendor* rather
  // than a user. Each supplies `vendorActor`, because a customer token carries
  // neither the CREATE_OR_EDIT_PRODUCT grant nor a vendor for `tenantContext`
  // to resolve.
  {
    method: 'POST',
    prefix: '/api/v1/vendor/products',
    path: '/',
    classification: 'SELF_SCOPED',
    why: 'Creates under the caller’s own tenant; the vendor comes from the tenant context, never the body.',
  },
  {
    method: 'GET',
    prefix: '/api/v1/vendor/products',
    path: '/',
    classification: 'SELF_SCOPED',
    why: 'Lists only the caller’s own products — the tenant-scoped client cannot return anyone else’s.',
  },
  {
    method: 'GET',
    prefix: '/api/v1/vendor/products',
    path: '/:productId',
    classification: 'TENANT_OWNED',
    why: 'Accepts a client-supplied product id and reads it.',
    actor: vendorActor,
    seed: seedProduct,
    attempt: (ctx, actor, resourceId) =>
      authed(request(ctx.app).get(`/api/v1/vendor/products/${resourceId}`), actor),
  },
  {
    method: 'PATCH',
    prefix: '/api/v1/vendor/products',
    path: '/:productId',
    classification: 'TENANT_OWNED',
    why: 'Accepts a client-supplied product id and writes to it.',
    actor: vendorActor,
    seed: seedProduct,
    attempt: (ctx, actor, resourceId) =>
      authed(request(ctx.app).patch(`/api/v1/vendor/products/${resourceId}`), actor).send({
        name: 'Hijacked',
      }),
    snapshot: snapshotProduct,
  },
  {
    method: 'DELETE',
    prefix: '/api/v1/vendor/products',
    path: '/:productId',
    classification: 'TENANT_OWNED',
    why: 'Accepts a client-supplied product id and soft-deletes it.',
    actor: vendorActor,
    seed: seedProduct,
    attempt: (ctx, actor, resourceId) =>
      authed(request(ctx.app).delete(`/api/v1/vendor/products/${resourceId}`), actor),
    snapshot: snapshotProduct,
  },
  {
    method: 'POST',
    prefix: '/api/v1/vendor/products',
    path: '/:productId/variants',
    classification: 'SELF_SCOPED',
    why: 'Adds under a product the tenant-scoped lookup already proved is the caller’s own.',
  },
  {
    method: 'GET',
    prefix: '/api/v1/vendor/products',
    path: '/:productId/variants',
    classification: 'SELF_SCOPED',
    why: 'Lists variants of a product the tenant-scoped lookup already proved is the caller’s own.',
  },
  {
    method: 'GET',
    prefix: '/api/v1/vendor/products',
    path: '/:productId/variants/:variantId',
    classification: 'TENANT_OWNED',
    why: 'Accepts a client-supplied variant id and reads it.',
    actor: vendorActor,
    seed: seedVariant,
    attempt: (ctx, actor, resourceId) =>
      authed(request(ctx.app).get(`/api/v1/vendor/products/${variantPath(resourceId)}`), actor),
  },
  {
    method: 'PATCH',
    prefix: '/api/v1/vendor/products',
    path: '/:productId/variants/:variantId',
    classification: 'TENANT_OWNED',
    why: 'Accepts a client-supplied variant id and writes to it.',
    actor: vendorActor,
    seed: seedVariant,
    attempt: (ctx, actor, resourceId) =>
      authed(
        request(ctx.app).patch(`/api/v1/vendor/products/${variantPath(resourceId)}`),
        actor,
      ).send({ name: 'Hijacked' }),
    snapshot: snapshotVariant,
  },
  {
    method: 'DELETE',
    prefix: '/api/v1/vendor/products',
    path: '/:productId/variants/:variantId',
    classification: 'TENANT_OWNED',
    why: 'Accepts a client-supplied variant id and soft-deletes it.',
    actor: vendorActor,
    seed: seedVariant,
    attempt: (ctx, actor, resourceId) =>
      authed(request(ctx.app).delete(`/api/v1/vendor/products/${variantPath(resourceId)}`), actor),
    snapshot: snapshotVariant,
  },

  // Per-variant stock (S2-4). TENANT_OWNED for the same reason the variant
  // routes are: both ids come from the client, and a counter belonging to
  // another vendor must read as absent rather than forbidden.
  {
    method: 'GET',
    prefix: '/api/v1/vendor/products',
    path: '/:productId/variants/:variantId/inventory',
    classification: 'TENANT_OWNED',
    why: 'Accepts a client-supplied variant id and reads its stock level.',
    actor: vendorActor,
    seed: seedVariant,
    attempt: (ctx, actor, resourceId) =>
      authed(
        request(ctx.app).get(`/api/v1/vendor/products/${variantPath(resourceId)}/inventory`),
        actor,
      ),
  },
  {
    method: 'PATCH',
    prefix: '/api/v1/vendor/products',
    path: '/:productId/variants/:variantId/inventory',
    classification: 'TENANT_OWNED',
    why: 'Accepts a client-supplied variant id and writes its stock level.',
    actor: vendorActor,
    seed: seedVariant,
    attempt: (ctx, actor, resourceId) =>
      authed(
        request(ctx.app).patch(`/api/v1/vendor/products/${variantPath(resourceId)}/inventory`),
        actor,
      ).send({ available: 999, version: 1 }),
    snapshot: snapshotInventory,
  },

  // Per-product media (S2-6a). `POST`/`GET` are SELF_SCOPED for the same
  // reasoning `POST`/`GET .../variants` above are: both run against a
  // product the tenant-scoped lookup already proved is the caller's own, so
  // they lean on the mechanism the `:productId` TENANT_OWNED entries above
  // already exercise rather than repeating it. `complete`/`remove` name a
  // media id of their own, so — like `:variantId` — those two get their own
  // proof.
  {
    method: 'POST',
    prefix: '/api/v1/vendor/products',
    path: '/:productId/media',
    classification: 'SELF_SCOPED',
    why: 'Mints an upload intent under a product the tenant-scoped lookup already proved is the caller’s own.',
  },
  {
    method: 'GET',
    prefix: '/api/v1/vendor/products',
    path: '/:productId/media',
    classification: 'SELF_SCOPED',
    why: 'Lists media of a product the tenant-scoped lookup already proved is the caller’s own.',
  },
  {
    method: 'POST',
    prefix: '/api/v1/vendor/products',
    path: '/:productId/media/:mediaId/complete',
    classification: 'TENANT_OWNED',
    why: 'Accepts a client-supplied media id and completes it.',
    actor: vendorActor,
    seed: seedMedia,
    attempt: (ctx, actor, resourceId) =>
      authed(
        request(ctx.app).post(`/api/v1/vendor/products/${mediaPath(resourceId)}/complete`),
        actor,
      ),
    snapshot: snapshotMedia,
  },
  {
    method: 'DELETE',
    prefix: '/api/v1/vendor/products',
    path: '/:productId/media/:mediaId',
    classification: 'TENANT_OWNED',
    why: 'Accepts a client-supplied media id and soft-deletes it.',
    actor: vendorActor,
    seed: seedMedia,
    attempt: (ctx, actor, resourceId) =>
      authed(request(ctx.app).delete(`/api/v1/vendor/products/${mediaPath(resourceId)}`), actor),
    snapshot: snapshotMedia,
  },

  // S2-5: DRAFT/REJECTED -> PENDING_REVIEW. Same tenant-owned reasoning as
  // the routes above — the id is client-supplied and belongs to a specific
  // vendor's product.
  {
    method: 'POST',
    prefix: '/api/v1/vendor/products',
    path: '/:productId/submit',
    classification: 'TENANT_OWNED',
    why: 'Accepts a client-supplied product id and transitions its moderation status.',
    actor: vendorActor,
    seed: seedProduct,
    attempt: (ctx, actor, resourceId) =>
      authed(request(ctx.app).post(`/api/v1/vendor/products/${resourceId}/submit`), actor),
    snapshot: snapshotProduct,
  },

  // --- admin product moderation: /api/v1/admin/products (S2-5) ---
  // Cross-tenant by design, the same reasoning the admin KYC surface above
  // gives: the review queue spans every vendor on the elevated credential,
  // and asserting isolation here would assert a bug.
  {
    method: 'GET',
    prefix: '/api/v1/admin/products',
    path: '/submissions',
    classification: 'ADMIN',
    why: 'The moderation queue is cross-tenant by design (S2-5, SDD 15.2).',
  },
  {
    method: 'GET',
    prefix: '/api/v1/admin/products',
    path: '/submissions/:productId',
    classification: 'ADMIN',
    why: 'Admin detail read across every vendor, on the elevated credential.',
  },
  {
    method: 'POST',
    prefix: '/api/v1/admin/products',
    path: '/submissions/:productId/decision',
    classification: 'ADMIN',
    why: 'Admin approve/reject decision across every vendor (S2-5, SDD 15.2).',
  },

  // --- customer self-service: /api/v1/me ---
  {
    method: 'POST',
    prefix: '/api/v1/me',
    path: '/addresses',
    classification: 'SELF_SCOPED',
    why: 'Creates under the caller’s own principal; takes no resource id.',
  },
  {
    method: 'GET',
    prefix: '/api/v1/me',
    path: '/addresses',
    classification: 'SELF_SCOPED',
    why: 'Lists only the caller’s own addresses; takes no resource id.',
  },
  {
    method: 'PATCH',
    prefix: '/api/v1/me',
    path: '/addresses/:id',
    classification: 'TENANT_OWNED',
    why: 'Accepts a client-supplied address id and writes to it.',
    seed: seedAddress,
    attempt: (ctx, actor, resourceId) =>
      authed(request(ctx.app).patch(`/api/v1/me/addresses/${resourceId}`), actor).send({
        city: 'Nowhere',
      }),
    snapshot: snapshotAddress,
  },
  {
    method: 'DELETE',
    prefix: '/api/v1/me',
    path: '/addresses/:id',
    classification: 'TENANT_OWNED',
    why: 'Accepts a client-supplied address id and soft-deletes it.',
    seed: seedAddress,
    attempt: (ctx, actor, resourceId) =>
      authed(request(ctx.app).delete(`/api/v1/me/addresses/${resourceId}`), actor),
    snapshot: snapshotAddress,
  },
  {
    method: 'POST',
    prefix: '/api/v1/me',
    path: '/addresses/:id/default',
    classification: 'TENANT_OWNED',
    why: 'Accepts a client-supplied address id and flips a flag on it.',
    seed: seedAddress,
    attempt: (ctx, actor, resourceId) =>
      authed(request(ctx.app).post(`/api/v1/me/addresses/${resourceId}/default`), actor),
    snapshot: snapshotAddress,
  },

  // --- public search: /api/v1/search (S2-7) ---
  // Unauthenticated (auth optional) and tenant-free, the same underlying
  // reason `/api/v1/catalogue/*` above is PUBLIC: `products_public_read`'s
  // RLS policy is what confines this surface to `APPROVED`, non-deleted
  // rows, on its own `leenmart_public` credential — there is no tenant
  // context to establish and nothing here reads across one.
  {
    method: 'GET',
    prefix: '/api/v1/search',
    path: '/',
    classification: 'PUBLIC',
    why: 'Unauthenticated (auth-optional) product search; RLS on leenmart_public confines results to APPROVED, non-deleted rows regardless of tenant.',
  },

  // --- cart: /api/v1/me/cart (S3-1) ---
  {
    method: 'GET',
    prefix: '/api/v1/me',
    path: '/cart',
    classification: 'SELF_SCOPED',
    why: 'Returns only the caller’s own cart; takes no resource id.',
  },
  {
    method: 'POST',
    prefix: '/api/v1/me',
    path: '/cart/items',
    classification: 'SELF_SCOPED',
    why: 'Adds to the caller’s own cart (created on first use); takes no resource id.',
  },
  {
    method: 'PATCH',
    prefix: '/api/v1/me',
    path: '/cart/items/:itemId',
    classification: 'TENANT_OWNED',
    why: 'Accepts a client-supplied cart item id and writes to it.',
    seed: seedCartItem,
    attempt: (ctx, actor, resourceId) =>
      authed(request(ctx.app).patch(`/api/v1/me/cart/items/${resourceId}`), actor).send({
        quantity: 2,
      }),
    snapshot: snapshotCartItem,
  },
  {
    method: 'DELETE',
    prefix: '/api/v1/me',
    path: '/cart/items/:itemId',
    classification: 'TENANT_OWNED',
    why: 'Accepts a client-supplied cart item id and soft-deletes it.',
    seed: seedCartItem,
    attempt: (ctx, actor, resourceId) =>
      authed(request(ctx.app).delete(`/api/v1/me/cart/items/${resourceId}`), actor),
    snapshot: snapshotCartItem,
  },
  {
    method: 'DELETE',
    prefix: '/api/v1/me',
    path: '/cart',
    classification: 'SELF_SCOPED',
    why: 'Clears only the caller’s own cart; takes no resource id.',
  },

  // --- orders: /api/v1/orders (S3-3A) ---
  {
    method: 'POST',
    prefix: '/api/v1/orders',
    path: '/',
    classification: 'SELF_SCOPED',
    why: 'Places an order from the caller’s own cart; takes no resource id.',
  },
  {
    method: 'GET',
    prefix: '/api/v1/orders',
    path: '/',
    classification: 'SELF_SCOPED',
    why: 'Lists only the caller’s own orders (S3-4, "My Orders"); takes no resource id.',
  },
  {
    method: 'GET',
    prefix: '/api/v1/orders',
    path: '/:id',
    classification: 'TENANT_OWNED',
    why: 'Accepts a client-supplied order id and reads it.',
    seed: seedOrder,
    attempt: (ctx, actor, resourceId) =>
      authed(request(ctx.app).get(`/api/v1/orders/${resourceId}`), actor),
    snapshot: snapshotOrder,
  },
  {
    method: 'POST',
    prefix: '/api/v1/orders',
    path: '/:id/cancel',
    classification: 'TENANT_OWNED',
    why: 'Accepts a client-supplied order id and cancels it.',
    seed: seedOrder,
    attempt: (ctx, actor, resourceId) =>
      authed(request(ctx.app).post(`/api/v1/orders/${resourceId}/cancel`), actor),
    snapshot: snapshotOrder,
  },

  // --- orders: payment (S3-3B) ---
  {
    method: 'POST',
    prefix: '/api/v1/orders',
    path: '/:id/payment/initiate',
    classification: 'TENANT_OWNED',
    why: 'Accepts a client-supplied order id and starts a payment attempt for it.',
    seed: seedOrder,
    attempt: (ctx, actor, resourceId) =>
      authed(request(ctx.app).post(`/api/v1/orders/${resourceId}/payment/initiate`), actor).set(
        'Idempotency-Key',
        `matrix-${randomUUID()}`,
      ),
    snapshot: snapshotOrder,
  },
  {
    method: 'POST',
    prefix: '/api/v1/orders',
    path: '/:id/payment/confirm',
    classification: 'TENANT_OWNED',
    why: 'Accepts a client-supplied order id and confirms payment for it — ownership is checked before any payment attempt lookup, so this refuses a non-owner regardless of whether one was ever initiated.',
    seed: seedOrder,
    attempt: (ctx, actor, resourceId) =>
      authed(request(ctx.app).post(`/api/v1/orders/${resourceId}/payment/confirm`), actor)
        .set('Idempotency-Key', `matrix-${randomUUID()}`)
        .send({ testScenario: 'SUCCEEDED' }),
    snapshot: snapshotOrder,
  },

  // --- vendor orders: /api/v1/vendor/orders (S3-5) ---
  //
  // Addressed by SubOrderId throughout (locked decision #5) — every seed here
  // returns a sub-order id, never the parent order id. Each supplies
  // `vendorActor`, the same reason `vendor/products` routes do: a customer
  // token carries neither `VIEW_VENDOR_ORDERS`/`ACCEPT_OR_REJECT_ORDER` nor a
  // vendor for `tenantContext` to resolve.
  {
    method: 'GET',
    prefix: '/api/v1/vendor/orders',
    path: '/',
    classification: 'SELF_SCOPED',
    why: 'Lists only the caller’s own sub-orders — the tenant-scoped client cannot return anyone else’s.',
  },
  {
    method: 'GET',
    prefix: '/api/v1/vendor/orders',
    path: '/:id',
    classification: 'TENANT_OWNED',
    why: 'Accepts a client-supplied sub-order id and reads it.',
    actor: activeVendorActor,
    seed: seedVendorSubOrder,
    attempt: (ctx, actor, resourceId) =>
      authed(request(ctx.app).get(`/api/v1/vendor/orders/${resourceId}`), actor),
    snapshot: snapshotVendorSubOrder,
  },
  {
    method: 'POST',
    prefix: '/api/v1/vendor/orders',
    path: '/:id/process',
    classification: 'TENANT_OWNED',
    why: 'Accepts a client-supplied sub-order id and starts processing it.',
    actor: activeVendorActor,
    seed: seedVendorSubOrder,
    attempt: (ctx, actor, resourceId) =>
      authed(request(ctx.app).post(`/api/v1/vendor/orders/${resourceId}/process`), actor),
    snapshot: snapshotVendorSubOrder,
  },
];

export const isTenantOwned = (route: ManifestRoute): route is TenantOwnedRoute =>
  route.classification === 'TENANT_OWNED';

/**
 * The key the completeness guard compares on: method plus **sub-path only**,
 * because that is all Express 5 exposes.
 *
 * Three consequences, all accepted deliberately (S2-1, RD3):
 *
 *   * `POST /login` is mounted by both the identity router and the admin auth
 *     router. They collapse to one key here, so the guard cannot tell them
 *     apart — both are still classified individually above.
 *   * `POST /` is likewise mounted by both the vendor router (registration)
 *     and the admin categories router (create). Same collapse, same handling:
 *     each is classified on its own entry, and the set absorbs the overlap.
 *   * `app.ts` currently mounts `adminKycRouter` twice at the same prefix, so
 *     the live router reports its five routes twice. Set semantics absorb the
 *     duplicate rather than failing on it; this is a pre-existing condition in
 *     production code that S2-1 did not touch.
 */
export const routeKey = (method: string, path: string): string => `${method.toUpperCase()} ${path}`;

export const declaredRouteKeys = (): ReadonlySet<string> =>
  new Set(ROUTE_MANIFEST.map((route) => routeKey(route.method, route.path)));
