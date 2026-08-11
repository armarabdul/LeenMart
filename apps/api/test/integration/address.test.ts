import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createApp } from '../../src/app.js';
import { type Container, createContainer } from '../../src/container.js';

interface AuthSessionBody {
  data: { user: { id: string; role: string }; accessToken: string };
}

interface AddressBody {
  data: {
    id: string;
    recipientName: string;
    city: string;
    isDefault: boolean;
  };
}

interface AddressListBody {
  data: AddressBody['data'][];
}

interface ErrorBody {
  error: { code: string; message: string };
}

const EMAIL_PREFIX = 'address-integration-';

const uniqueEmail = (label: string): string =>
  `${EMAIL_PREFIX}${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;

const PASSWORD = 'correct horse battery staple';

const VALID_ADDRESS = {
  recipientName: 'Asha Rao',
  phone: '+919876543210',
  line1: '221B Baker Street',
  city: 'Bengaluru',
  state: 'Karnataka',
  pincode: '560001',
  label: 'Home',
};

/**
 * Integration test against real PostgreSQL, following `vendor.test.ts`'s
 * conventions. Covers the full authenticated address-book flow through the
 * HTTP surface: `/api/v1/me/addresses` (SDD 9.4 customer self-service).
 */
describe('customer address book endpoints', () => {
  let container: Container;
  let app: Express;

  const signUpCustomer = async (label: string): Promise<{ token: string; userId: string }> => {
    const response = await request(app)
      .post('/api/v1/identity/register')
      .send({ email: uniqueEmail(label), password: PASSWORD })
      .expect(201);
    const body = response.body as AuthSessionBody;
    return { token: body.data.accessToken, userId: body.data.user.id };
  };

  const addAddress = (token: string, overrides: Partial<typeof VALID_ADDRESS> = {}): request.Test =>
    request(app)
      .post('/api/v1/me/addresses')
      .set('Authorization', `Bearer ${token}`)
      .send({ ...VALID_ADDRESS, ...overrides });

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
    await container.prisma.address.deleteMany({ where: { userId: { in: ids } } });
    await container.prisma.user.deleteMany({ where: { id: { in: ids } } });
    await container.dispose();
  });

  it('adds an address for the authenticated customer and makes the first one the default', async () => {
    const { token } = await signUpCustomer('add');

    const response = await addAddress(token).expect(201);

    const body = response.body as AddressBody;
    expect(body.data.recipientName).toBe(VALID_ADDRESS.recipientName);
    expect(body.data.isDefault).toBe(true);
  });

  it('rejects an unauthenticated request', async () => {
    const response = await request(app)
      .post('/api/v1/me/addresses')
      .send(VALID_ADDRESS)
      .expect(401);
    expect((response.body as ErrorBody).error.code).toBe('INVALID_ACCESS_TOKEN');
  });

  it('rejects a request missing required fields with the validation envelope', async () => {
    const { token } = await signUpCustomer('validation');

    const response = await request(app)
      .post('/api/v1/me/addresses')
      .set('Authorization', `Bearer ${token}`)
      .send({ recipientName: 'Asha Rao' })
      .expect(400);

    expect((response.body as ErrorBody).error.code).toBe('VALIDATION_FAILED');
  });

  it('rejects an unexpected body field, closing the mass-assignment hole', async () => {
    const { token } = await signUpCustomer('mass-assignment');

    const response = await addAddress(token, { isDefault: true } as never).expect(400);

    expect((response.body as ErrorBody).error.code).toBe('VALIDATION_FAILED');
  });

  it('lists only the authenticated customer’s own addresses', async () => {
    const { token } = await signUpCustomer('list-mine');
    const { token: otherToken } = await signUpCustomer('list-other');
    await addAddress(token).expect(201);
    await addAddress(otherToken).expect(201);

    const response = await request(app)
      .get('/api/v1/me/addresses')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect((response.body as AddressListBody).data).toHaveLength(1);
  });

  it('updates only the supplied fields via PATCH', async () => {
    const { token } = await signUpCustomer('update');
    const created = await addAddress(token).expect(201);
    const id = (created.body as AddressBody).data.id;

    const response = await request(app)
      .patch(`/api/v1/me/addresses/${id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ city: 'Mumbai' })
      .expect(200);

    const body = response.body as AddressBody;
    expect(body.data.city).toBe('Mumbai');
    expect(body.data.recipientName).toBe(VALID_ADDRESS.recipientName);
  });

  it('returns 404, not 403, for another customer’s address id on PATCH/DELETE', async () => {
    const { token: ownerToken } = await signUpCustomer('cross-owner');
    const { token: attackerToken } = await signUpCustomer('cross-attacker');
    const created = await addAddress(ownerToken).expect(201);
    const id = (created.body as AddressBody).data.id;

    const patchResponse = await request(app)
      .patch(`/api/v1/me/addresses/${id}`)
      .set('Authorization', `Bearer ${attackerToken}`)
      .send({ city: 'Nowhere' })
      .expect(404);
    const deleteResponse = await request(app)
      .delete(`/api/v1/me/addresses/${id}`)
      .set('Authorization', `Bearer ${attackerToken}`)
      .expect(404);

    expect((patchResponse.body as ErrorBody).error.code).toBe('ADDRESS_NOT_FOUND');
    expect((deleteResponse.body as ErrorBody).error.code).toBe('ADDRESS_NOT_FOUND');
  });

  it('returns 404 for an unknown address id', async () => {
    const { token } = await signUpCustomer('unknown-id');

    const response = await request(app)
      .delete('/api/v1/me/addresses/00000000-0000-7000-8000-000000000000')
      .set('Authorization', `Bearer ${token}`)
      .expect(404);

    expect((response.body as ErrorBody).error.code).toBe('ADDRESS_NOT_FOUND');
  });

  it('removes an address via DELETE and it no longer appears in the list', async () => {
    const { token } = await signUpCustomer('remove');
    const created = await addAddress(token).expect(201);
    const id = (created.body as AddressBody).data.id;

    const response = await request(app)
      .delete(`/api/v1/me/addresses/${id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect((response.body as { data: { success: boolean } }).data.success).toBe(true);
    const listResponse = await request(app)
      .get('/api/v1/me/addresses')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect((listResponse.body as AddressListBody).data).toHaveLength(0);
  });

  it('sets a different address as default via POST /:id/default, unsetting the previous one', async () => {
    const { token } = await signUpCustomer('set-default');
    const first = await addAddress(token).expect(201);
    const second = await addAddress(token, { label: 'Work' }).expect(201);
    const secondId = (second.body as AddressBody).data.id;

    const response = await request(app)
      .post(`/api/v1/me/addresses/${secondId}/default`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect((response.body as AddressBody).data.isDefault).toBe(true);
    const listResponse = await request(app)
      .get('/api/v1/me/addresses')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const list = (listResponse.body as AddressListBody).data;
    expect(list.filter((address) => address.isDefault)).toHaveLength(1);
    expect(
      list.find((address) => address.id === (first.body as AddressBody).data.id)?.isDefault,
    ).toBe(false);
  });

  it('race: two concurrent default-address requests never leave the customer with zero or two defaults', async () => {
    const { token } = await signUpCustomer('race');
    await addAddress(token).expect(201);
    const second = await addAddress(token, { label: 'Work' }).expect(201);
    const third = await addAddress(token, { label: 'Office' }).expect(201);
    const secondId = (second.body as AddressBody).data.id;
    const thirdId = (third.body as AddressBody).data.id;

    const setDefault = (id: string): request.Test =>
      request(app)
        .post(`/api/v1/me/addresses/${id}/default`)
        .set('Authorization', `Bearer ${token}`);

    const [first, other] = await Promise.all([setDefault(secondId), setDefault(thirdId)]);

    // Row-level locking on the shared "current default" row serializes the
    // two requests' clear-then-set steps, so both commonly return 200 (the
    // later commit simply wins) — the partial unique index is the backstop
    // for the case that ordering doesn't hold, hence allowing either 200 or
    // 409 here. What must never happen, under either outcome, is the
    // customer ending up with zero or two defaults.
    for (const response of [first, other]) {
      expect([200, 409]).toContain(response.status);
      if (response.status === 409) {
        expect((response.body as ErrorBody).error.code).toBe('ADDRESS_DEFAULT_CONFLICT');
      }
    }

    const listResponse = await request(app)
      .get('/api/v1/me/addresses')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(
      (listResponse.body as AddressListBody).data.filter((address) => address.isDefault),
    ).toHaveLength(1);
  });

  it('race: two concurrent first-address adds for a brand new customer never leave zero or two defaults', async () => {
    const { token } = await signUpCustomer('first-add-race');

    // Neither request has an existing default row to serialize against (SDD
    // requirement: never leave a race condition merely because sequential
    // tests pass) — this is the scenario that actually exercises the
    // partial unique index, unlike setting default among pre-existing rows.
    const [first, second] = await Promise.all([
      addAddress(token, { label: 'Home' }),
      addAddress(token, { label: 'Work' }),
    ]);

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);

    const listResponse = await request(app)
      .get('/api/v1/me/addresses')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const list = (listResponse.body as AddressListBody).data;
    expect(list).toHaveLength(2);
    expect(list.filter((address) => address.isDefault)).toHaveLength(1);
  });
});
