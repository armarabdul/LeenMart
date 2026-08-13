import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { Express } from 'express';
import type { PrismaClient } from '@prisma/client';
import { signUpVendorOwner, type Actor } from './actors.js';

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
const vendorActors = new Map<string, Actor>();
const vendorActor = async (ctx: RouteTestContext, label: string): Promise<Actor> => {
  const cached = vendorActors.get(label);
  if (cached) return cached;
  // Awaited before caching, so a failed mint is retried rather than turned
  // into a permanently cached rejection.
  const minted = await signUpVendorOwner(ctx.app, VENDOR_EMAIL_PREFIX, label);
  vendorActors.set(label, minted);
  return minted;
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
