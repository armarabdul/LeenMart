import request from 'supertest';
import type { Express } from 'express';
import type { PrismaClient } from '@prisma/client';
import type { Actor } from './actors.js';

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
 * Two consequences, both accepted deliberately (S2-1, RD3):
 *
 *   * `POST /login` is mounted by both the identity router and the admin auth
 *     router. They collapse to one key here, so the guard cannot tell them
 *     apart — both are still classified individually above.
 *   * `app.ts` currently mounts `adminKycRouter` twice at the same prefix, so
 *     the live router reports its five routes twice. Set semantics absorb the
 *     duplicate rather than failing on it; this is a pre-existing condition in
 *     production code that S2-1 does not touch.
 */
export const routeKey = (method: string, path: string): string => `${method.toUpperCase()} ${path}`;

export const declaredRouteKeys = (): ReadonlySet<string> =>
  new Set(ROUTE_MANIFEST.map((route) => routeKey(route.method, route.path)));
