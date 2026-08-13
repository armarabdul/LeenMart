import request from 'supertest';
import type { Express } from 'express';

/**
 * The two independent principals a cross-tenant test needs, minted through
 * the real HTTP surface rather than seeded into the database — an isolation
 * proof is only worth something if the attacker holds a token the application
 * itself issued.
 *
 * Only what the route matrix actually uses lives here. Vendor and admin
 * actors are *not* pre-built: no vendor-facing route owns an addressable
 * resource yet (S2-1 inspection), so a vendor actor here would be a helper
 * with no caller. They join when the first `TENANT_OWNED` vendor route does.
 */
export interface Actor {
  readonly token: string;
  readonly userId: string;
  readonly email: string;
}

interface AuthSessionBody {
  data: { user: { id: string }; accessToken: string };
}

/** Long enough for the registration schema, and not a credential anyone could reuse elsewhere. */
export const TEST_PASSWORD = 'correct horse battery staple';

/**
 * Collision-proof across parallel files and repeated local runs: the prefix
 * is what `disposeIntegrationHarness` cleans up by, so it must be unique to
 * the suite and shared by every account the suite creates.
 */
export const uniqueEmail = (prefix: string, label: string): string =>
  `${prefix}${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`.toLowerCase();

/** Registers a customer and returns the session that registration itself issued. */
export const signUpCustomer = async (
  app: Express,
  prefix: string,
  label: string,
): Promise<Actor> => {
  const email = uniqueEmail(prefix, label);
  const response = await request(app)
    .post('/api/v1/identity/register')
    .send({ email, password: TEST_PASSWORD })
    .expect(201);

  const body = response.body as AuthSessionBody;
  return { token: body.data.accessToken, userId: body.data.user.id, email };
};
