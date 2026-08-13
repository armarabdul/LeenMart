import request from 'supertest';
import type { Express } from 'express';

/**
 * The two independent principals a cross-tenant test needs, minted through
 * the real HTTP surface rather than seeded into the database — an isolation
 * proof is only worth something if the attacker holds a token the application
 * itself issued.
 *
 * Only what the route matrix actually uses lives here. The vendor actor below
 * joined with S2-3b, which added the first vendor-owned `TENANT_OWNED` routes
 * — exactly the moment S2-1 said it would.
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

/** A vendor owner: a registered customer who has been promoted by registering a vendor. */
export interface VendorActor extends Actor {
  readonly vendorId: string;
}

interface VendorRegistrationBody {
  data: { id: string };
}

/**
 * Registers a customer, registers a vendor for them, and signs back in.
 *
 * The re-login is not incidental — vendor registration promotes the account to
 * `VENDOR_OWNER` and **revokes every session it had** (the KYC-3 role-lifecycle
 * decision), so the token registration itself returned is dead by the time the
 * vendor exists. Signing in again is what yields a token carrying the
 * `VENDOR_OWNER` claim that `requirePermission('CREATE_OR_EDIT_PRODUCT')`
 * needs and that `tenantContext` can resolve a vendor from.
 *
 * Everything goes through the real HTTP surface rather than seeded rows: an
 * isolation proof is only worth something if the attacker holds a token the
 * application itself issued.
 */
export const signUpVendorOwner = async (
  app: Express,
  prefix: string,
  label: string,
): Promise<VendorActor> => {
  const customer = await signUpCustomer(app, prefix, label);

  const registered = await request(app)
    .post('/api/v1/vendors')
    .set('Authorization', `Bearer ${customer.token}`)
    .send({})
    .expect(201);
  const vendorId = (registered.body as VendorRegistrationBody).data.id;

  const signedIn = await request(app)
    .post('/api/v1/identity/login')
    .send({ email: customer.email, password: TEST_PASSWORD })
    .expect(200);

  return {
    token: (signedIn.body as AuthSessionBody).data.accessToken,
    userId: customer.userId,
    email: customer.email,
    vendorId,
  };
};
