import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import type { Express } from 'express';
import { createApp } from '../../src/app.js';
import { type Container, createContainer } from '../../src/container.js';

interface AuthSessionBody {
  data: {
    user: { id: string; email?: string; role: string };
    accessToken: string;
    refreshToken: string;
  };
}

interface VendorBody {
  data: { id: string; status: string };
}

interface ErrorBody {
  error: { code: string; message: string };
}

const EMAIL_PREFIX = 'vendor-integration-';

const uniqueEmail = (label: string): string =>
  `${EMAIL_PREFIX}${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;

const PASSWORD = 'correct horse battery staple';

/**
 * Integration test against real PostgreSQL, following `identity.test.ts`'s
 * conventions. Covers the full authenticated registration flow through the
 * HTTP surface: POST /api/v1/vendors (SDD 9.2 plural resource + POST create).
 */
describe('vendor endpoints', () => {
  let container: Container;
  let app: Express;

  /** Registers a customer and returns their access token plus user id. */
  const signUpCustomer = async (
    label: string,
  ): Promise<{ token: string; userId: string; email: string }> => {
    const email = uniqueEmail(label);
    const response = await request(app)
      .post('/api/v1/identity/register')
      .send({ email, password: PASSWORD })
      .expect(201);
    const body = response.body as AuthSessionBody;
    return { token: body.data.accessToken, userId: body.data.user.id, email };
  };

  /** Signs back in — necessary after registration, which revokes every session. */
  const logIn = async (email: string): Promise<{ token: string; role: string }> => {
    const response = await request(app)
      .post('/api/v1/identity/login')
      .send({ email, password: PASSWORD })
      .expect(200);
    const body = response.body as AuthSessionBody;
    return { token: body.data.accessToken, role: body.data.user.role };
  };

  const registerVendor = (token: string): request.Test =>
    request(app).post('/api/v1/vendors').set('Authorization', `Bearer ${token}`).send({});

  /**
   * Test setup and assertions observe the database as the **owner**, not
   * through `container.prisma`. The container's client is the vendor-scoped
   * runtime client (KYC-2B-2/2B-3): outside a request it has no tenant
   * context, so a tenant-scoped read through it fails closed — correctly. A
   * test inspecting stored state is acting as an operator, and should connect
   * like one.
   */
  const db = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL ?? '' } } });

  beforeAll(() => {
    process.env.ENV_FILE = '.env.test';
    container = createContainer();
    app = createApp(container);
  });

  afterAll(async () => {
    const users = await db.user.findMany({
      where: { email: { contains: EMAIL_PREFIX } },
      select: { id: true },
    });
    const ids = users.map((user) => user.id);
    await db.vendorProfile.deleteMany({ where: { userId: { in: ids } } });
    await db.user.deleteMany({ where: { id: { in: ids } } });
    await db.$disconnect();
    await container.dispose();
  });

  it('registers a vendor for an authenticated customer and returns REGISTERED', async () => {
    const { token } = await signUpCustomer('register');

    const response = await registerVendor(token).expect(201);

    const body = response.body as VendorBody;
    expect(body.data.status).toBe('REGISTERED');
    expect(body.data.id).toEqual(expect.any(String) as unknown as string);
  });

  it('returns only the id and status — no other vendor fields', async () => {
    const { token } = await signUpCustomer('response-shape');

    const response = await registerVendor(token).expect(201);

    expect(Object.keys((response.body as VendorBody).data).sort()).toEqual(['id', 'status']);
  });

  it('persists the vendor against the authenticated caller', async () => {
    const { token, userId } = await signUpCustomer('persisted');

    const response = await registerVendor(token).expect(201);

    const stored = await db.vendorProfile.findUniqueOrThrow({ where: { userId } });
    expect(stored.id).toBe((response.body as VendorBody).data.id);
    expect(stored.status).toBe('REGISTERED');
  });

  it('promotes the caller to VENDOR_OWNER', async () => {
    // SDD 8.2 grants SUBMIT_OR_EDIT_KYC to VENDOR_OWNER and withholds it from
    // CUSTOMER, so without promotion a vendor could never submit the KYC its
    // own lifecycle requires.
    const { token, userId } = await signUpCustomer('promoted');

    await registerVendor(token).expect(201);

    const user = await db.user.findUniqueOrThrow({ where: { id: userId } });
    expect(user.role).toBe('VENDOR_OWNER');
  });

  it('revokes the session that performed the registration', async () => {
    // The token was minted with a CUSTOMER claim and is now stale; SDD 7.2's
    // denylist is what stops it rather than waiting for it to expire.
    const { token } = await signUpCustomer('revoked-self');

    await registerVendor(token).expect(201);

    await request(app)
      .get('/api/v1/identity/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(401);
  });

  it('revokes every other session the account holds', async () => {
    const { token, email } = await signUpCustomer('revoked-all');
    const other = await logIn(email);

    await registerVendor(token).expect(201);

    await request(app)
      .get('/api/v1/identity/me')
      .set('Authorization', `Bearer ${other.token}`)
      .expect(401);
  });

  it('issues a VENDOR_OWNER claim on the next login', async () => {
    const { token, email } = await signUpCustomer('next-login');
    await registerVendor(token).expect(201);

    const fresh = await logIn(email);

    expect(fresh.role).toBe('VENDOR_OWNER');
  });

  it('resolves the vendor tenant context after re-authentication', async () => {
    // Proof the whole chain works: the fresh token carries VENDOR_OWNER, so
    // the tenant middleware resolves the vendor and a tenant-scoped read
    // succeeds instead of failing closed.
    const { token, email, userId } = await signUpCustomer('tenant-after');
    await registerVendor(token).expect(201);
    const fresh = await logIn(email);

    const response = await registerVendor(fresh.token).expect(409);

    expect((response.body as ErrorBody).error.code).toBe('VENDOR_ALREADY_REGISTERED');
    expect(await db.vendorProfile.count({ where: { userId } })).toBe(1);
  });

  it('rejects a second registration for the same account', async () => {
    // Requires a fresh token, because the first registration revoked the one
    // that made it — the 409 itself is unchanged.
    const { token, email } = await signUpCustomer('duplicate');
    await registerVendor(token).expect(201);
    const fresh = await logIn(email);

    const response = await registerVendor(fresh.token).expect(409);

    expect((response.body as ErrorBody).error.code).toBe('VENDOR_ALREADY_REGISTERED');
  });

  it('rejects an unauthenticated request', async () => {
    const response = await request(app).post('/api/v1/vendors').send({}).expect(401);

    expect((response.body as ErrorBody).error.code).toBe('INVALID_ACCESS_TOKEN');
  });

  it('rejects an invalid access token', async () => {
    const response = await request(app)
      .post('/api/v1/vendors')
      .set('Authorization', 'Bearer not-a-real-token')
      .send({})
      .expect(401);

    expect((response.body as ErrorBody).error.code).toBe('INVALID_ACCESS_TOKEN');
  });

  it('rejects an unexpected body field, closing the mass-assignment hole', async () => {
    const { token } = await signUpCustomer('mass-assignment');

    const response = await request(app)
      .post('/api/v1/vendors')
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'ACTIVE' })
      .expect(400);

    expect((response.body as ErrorBody).error.code).toBe('VALIDATION_FAILED');
  });

  it('does not create a vendor when the body is rejected', async () => {
    const { token, userId } = await signUpCustomer('rejected-body');

    await request(app)
      .post('/api/v1/vendors')
      .set('Authorization', `Bearer ${token}`)
      .send({ userId: 'someone-else' })
      .expect(400);

    expect(await db.vendorProfile.findUnique({ where: { userId } })).toBeNull();
  });
});
