import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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
  const signUpCustomer = async (label: string): Promise<{ token: string; userId: string }> => {
    const response = await request(app)
      .post('/api/v1/identity/register')
      .send({ email: uniqueEmail(label), password: PASSWORD })
      .expect(201);
    const body = response.body as AuthSessionBody;
    return { token: body.data.accessToken, userId: body.data.user.id };
  };

  const registerVendor = (token: string): request.Test =>
    request(app).post('/api/v1/vendors').set('Authorization', `Bearer ${token}`).send({});

  beforeAll(() => {
    process.env.ENV_FILE = '.env.test';
    container = createContainer();
    app = createApp(container);
  });

  afterAll(async () => {
    const users = await container.prisma.user.findMany({
      where: { email: { contains: EMAIL_PREFIX } },
      select: { id: true },
    });
    const ids = users.map((user) => user.id);
    await container.prisma.vendorProfile.deleteMany({ where: { userId: { in: ids } } });
    await container.prisma.user.deleteMany({ where: { id: { in: ids } } });
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

    const stored = await container.prisma.vendorProfile.findUniqueOrThrow({ where: { userId } });
    expect(stored.id).toBe((response.body as VendorBody).data.id);
    expect(stored.status).toBe('REGISTERED');
  });

  it("does not change the caller's role", async () => {
    const { token, userId } = await signUpCustomer('role-unchanged');

    await registerVendor(token).expect(201);

    const user = await container.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(user.role).toBe('CUSTOMER');
  });

  it('rejects a second registration for the same account', async () => {
    const { token } = await signUpCustomer('duplicate');
    await registerVendor(token).expect(201);

    const response = await registerVendor(token).expect(409);

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

    expect(await container.prisma.vendorProfile.findUnique({ where: { userId } })).toBeNull();
  });
});
