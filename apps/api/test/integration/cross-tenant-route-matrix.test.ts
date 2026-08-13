import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Express } from 'express';
import { UuidV7Generator } from '@leen-mart/domain-kit';
import {
  createIntegrationHarness,
  disposeIntegrationHarness,
  type IntegrationHarness,
} from '../support/integration-app.js';
import { signUpCustomer, type Actor } from '../support/actors.js';
import {
  ROUTE_MANIFEST,
  declaredRouteKeys,
  isTenantOwned,
  routeKey,
  type RouteTestContext,
} from '../support/route-manifest.js';

const EMAIL_PREFIX = 'cross-tenant-matrix-';

const ids = new UuidV7Generator();

/**
 * Express 5's router internals, narrowed to the two fields this file reads.
 *
 * `app.router.stack` is not part of the public type surface, so it is reached
 * through an explicit local shape rather than `any` — the cast is contained
 * here and nowhere else.
 */
interface RouterLayer {
  readonly name?: string;
  readonly route?: { readonly path: string; readonly methods: Record<string, boolean> };
  readonly handle?: { readonly stack?: readonly RouterLayer[] };
}

interface RouterHost {
  readonly router?: { readonly stack?: readonly RouterLayer[] };
}

/**
 * Every `(method, sub-path)` pair the live application actually serves.
 *
 * **Sub-path only, and that is a limitation, not a choice.** Express 5 gives
 * a mounted router's layer `path === undefined` and replaces Express 4's
 * readable `regexp` with compiled matcher closures, so `/api/v1/me` is not
 * recoverable from the router at runtime. Prefixes are therefore declared in
 * the manifest and this guard reconciles the sub-paths (S2-1, RD3).
 *
 * Read from the real object graph — never by parsing source text, which would
 * go stale the moment a route was registered in a way the parser did not
 * anticipate.
 */
const mountedRoutes = (app: Express): ReadonlySet<string> => {
  const found = new Set<string>();

  const walk = (layers: readonly RouterLayer[] | undefined): void => {
    for (const layer of layers ?? []) {
      if (layer.route) {
        for (const method of Object.keys(layer.route.methods)) {
          found.add(routeKey(method, layer.route.path));
        }
      }
      walk(layer.handle?.stack);
    }
  };

  walk((app as unknown as RouterHost).router?.stack);
  return found;
};

/**
 * The response body with the two fields that differ on every single response
 * removed.
 *
 * `requestId` and `timestamp` are per-request correlation values present
 * identically on every envelope the platform emits, success or failure
 * (SDD 9.3). What must be indistinguishable between "not yours" and "does not
 * exist" is everything that could betray existence — status, code, message,
 * details — so those are exactly what this compares.
 */
const comparableBody = (body: unknown): string => {
  const parsed = JSON.parse(JSON.stringify(body)) as {
    error?: Record<string, unknown>;
  };
  if (parsed.error) {
    delete parsed.error.requestId;
    delete parsed.error.timestamp;
  }
  return JSON.stringify(parsed);
};

/**
 * SDD 6.6 layer 2: "For every vendor-facing endpoint, a test asserts that
 * Vendor A receives 404 for Vendor B's resource. This suite is generated from
 * the route table so a new endpoint without a test fails CI."
 *
 * Three parts. The **completeness guard** reconciles the declared manifest
 * against the live Express router in both directions, which is what makes a
 * new route without a classification fail. The **matrix** drives every
 * `TENANT_OWNED` entry through the same three proofs. The **vacuity guard**
 * fails if the matrix is ever empty, so this file cannot decay into a suite
 * that passes by covering nothing.
 *
 * Scope note: no vendor-facing route owns an addressable resource yet — all
 * three are collection-root or `/me`-scoped (S2-1 inspection). The matrix is
 * therefore seeded with the customer address book, which is genuinely
 * owner-scoped and exercises every assertion for real. Vendor routes enrol
 * themselves the moment one is added, because the guard will reject it until
 * it is classified.
 */
describe('cross-tenant route matrix (SDD 6.6 layer 2)', () => {
  let harness: IntegrationHarness;
  let app: Express;
  let ctx: RouteTestContext;

  beforeAll(() => {
    harness = createIntegrationHarness();
    app = harness.app;
    ctx = { app, db: harness.db };
  });

  afterAll(async () => {
    await disposeIntegrationHarness(harness, EMAIL_PREFIX);
  });

  describe('completeness guard', () => {
    it('classifies every route the application mounts', () => {
      const undeclared = [...mountedRoutes(app)].filter((key) => !declaredRouteKeys().has(key));

      // A new endpoint shipped without a manifest entry fails here — the CI
      // gate SDD 6.6 asks for. Fixing it means classifying the route, and
      // classifying it TENANT_OWNED enrols it in the matrix below.
      expect(undeclared).toEqual([]);
    });

    it('declares no route the application does not mount', () => {
      const mounted = mountedRoutes(app);
      const phantom = [...declaredRouteKeys()].filter((key) => !mounted.has(key));

      // The other direction: a manifest entry left behind after a route was
      // renamed or removed would otherwise sit here claiming false coverage.
      expect(phantom).toEqual([]);
    });

    it('gives every entry a written justification', () => {
      const unexplained = ROUTE_MANIFEST.filter((route) => route.why.trim().length === 0);

      expect(unexplained).toEqual([]);
    });
  });

  it('covers at least one owned-resource route', () => {
    // Guards against the failure mode where every route drifts into an
    // exclusion and the matrix silently proves nothing.
    expect(ROUTE_MANIFEST.filter(isTenantOwned).length).toBeGreaterThan(0);
  });

  describe.each(
    ROUTE_MANIFEST.filter(isTenantOwned).map((route) => ({
      label: `${route.method} ${route.prefix}${route.path}`,
      route,
    })),
  )('$label', ({ route }) => {
    /** Two unrelated accounts, each holding a resource the other must never reach. */
    const twoOwners = async (): Promise<{ attacker: Actor; victim: Actor; victimId: string }> => {
      const mint =
        route.actor ?? ((_ctx, label): Promise<Actor> => signUpCustomer(app, EMAIL_PREFIX, label));
      const attacker = await mint(ctx, 'attacker');
      const victim = await mint(ctx, 'victim');
      return { attacker, victim, victimId: await route.seed(ctx, victim) };
    };

    it('answers 404 for another owner’s resource', async () => {
      const { attacker, victimId } = await twoOwners();

      await route.attempt(ctx, attacker, victimId).expect(404);
    });

    it('is indistinguishable from a resource that never existed', async () => {
      const { attacker, victimId } = await twoOwners();

      const foreign = await route.attempt(ctx, attacker, victimId).expect(404);
      const absent = await route.attempt(ctx, attacker, ids.generate()).expect(404);

      // A different code, message or shape between these two would tell an
      // attacker that the id exists and belongs to someone else — the exact
      // disclosure the 404-not-403 convention exists to prevent.
      expect(comparableBody(foreign.body)).toBe(comparableBody(absent.body));
    });

    it('leaves the victim’s resource byte-for-byte unchanged', async () => {
      const { snapshot } = route;
      if (!snapshot) return; // read-only route: no write to disprove

      const { attacker, victimId } = await twoOwners();
      const before = await snapshot(ctx, victimId);

      await route.attempt(ctx, attacker, victimId).expect(404);

      // A 404 that had already mutated the row would satisfy the status
      // assertion above and still be a breach.
      expect(await snapshot(ctx, victimId)).toEqual(before);
    });

    it('still refuses the request without any credentials', async () => {
      const { victimId } = await twoOwners();

      await route.attempt(ctx, { token: '', userId: '', email: '' }, victimId).expect(401);
    });
  });
});
