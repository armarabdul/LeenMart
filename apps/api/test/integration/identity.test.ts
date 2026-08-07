import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createApp } from '../../src/app.js';
import { type Container, createContainer } from '../../src/container.js';

interface AuthSessionBody {
  data: {
    user: { id: string; email: string; role: string };
    accessToken: string;
    accessTokenExpiresAt: string;
    refreshToken: string;
    refreshTokenExpiresAt: string;
  };
}

interface ErrorBody {
  error: { code: string; message: string };
}

const EMAIL_PREFIX = 'identity-integration-';

const uniqueEmail = (label: string): string =>
  `${EMAIL_PREFIX}${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;

const registerCustomer = (app: Express, email: string, password: string): request.Test =>
  request(app).post('/api/v1/identity/register').send({ email, password });

/**
 * Integration test against real PostgreSQL (SDD README §"Conventions for the
 * first business module"). Requires `pnpm infra:up` and an applied migration.
 * Not mocked: rotation and uniqueness constraints are exactly what this suite
 * exists to prove.
 */
describe('identity endpoints', () => {
  let container: Container;
  let app: Express;

  beforeAll(() => {
    process.env.ENV_FILE = '.env.test';
    container = createContainer();
    app = createApp(container);
  });

  afterAll(async () => {
    await container.prisma.user.deleteMany({ where: { email: { contains: EMAIL_PREFIX } } });
    await container.dispose();
  });

  it('registers a new customer and returns a session', async () => {
    const email = uniqueEmail('register');

    const response = await registerCustomer(app, email, 'correct horse battery staple').expect(201);

    const body = response.body as AuthSessionBody;
    expect(body.data.user).toMatchObject({ email, role: 'CUSTOMER' });
    expect(body.data.accessToken).toEqual(expect.any(String));
    expect(body.data.refreshToken).toEqual(expect.any(String));
  });

  it('rejects a duplicate registration', async () => {
    const email = uniqueEmail('duplicate');
    await registerCustomer(app, email, 'correct horse battery staple').expect(201);

    const response = await registerCustomer(app, email, 'a different password').expect(409);

    expect((response.body as ErrorBody).error.code).toBe('EMAIL_ALREADY_REGISTERED');
  });

  it('rejects a field the client should not be able to set, closing the mass-assignment hole', async () => {
    const email = uniqueEmail('mass-assignment');

    await request(app)
      .post('/api/v1/identity/register')
      .send({ email, password: 'correct horse battery staple', role: 'ADMIN' })
      .expect(400);
  });

  it('logs a registered customer in', async () => {
    const email = uniqueEmail('login');
    const password = 'correct horse battery staple';
    await registerCustomer(app, email, password).expect(201);

    const response = await request(app).post('/api/v1/identity/login').send({ email, password }).expect(200);

    expect((response.body as AuthSessionBody).data.user.email).toBe(email);
  });

  it('rejects login with the wrong password without revealing which field was wrong', async () => {
    const email = uniqueEmail('bad-login');
    await registerCustomer(app, email, 'correct horse battery staple').expect(201);

    const response = await request(app)
      .post('/api/v1/identity/login')
      .send({ email, password: 'not the right password' })
      .expect(401);

    expect((response.body as ErrorBody).error.code).toBe('INVALID_CREDENTIALS');
  });

  it('rotates a refresh token and rejects reuse of the rotated-away token', async () => {
    const email = uniqueEmail('refresh');
    const registered = await registerCustomer(app, email, 'correct horse battery staple').expect(201);
    const originalRefreshToken = (registered.body as AuthSessionBody).data.refreshToken;

    const refreshed = await request(app)
      .post('/api/v1/identity/refresh')
      .send({ refreshToken: originalRefreshToken })
      .expect(200);
    expect((refreshed.body as AuthSessionBody).data.refreshToken).not.toBe(originalRefreshToken);

    const reused = await request(app)
      .post('/api/v1/identity/refresh')
      .send({ refreshToken: originalRefreshToken })
      .expect(401);
    expect((reused.body as ErrorBody).error.code).toBe('INVALID_REFRESH_TOKEN');
  });

  it('logs out and invalidates the refresh token', async () => {
    const email = uniqueEmail('logout');
    const registered = await registerCustomer(app, email, 'correct horse battery staple').expect(201);
    const refreshToken = (registered.body as AuthSessionBody).data.refreshToken;

    await request(app).post('/api/v1/identity/logout').send({ refreshToken }).expect(200);

    const response = await request(app).post('/api/v1/identity/refresh').send({ refreshToken }).expect(401);
    expect((response.body as ErrorBody).error.code).toBe('INVALID_REFRESH_TOKEN');
  });

  it('is idempotent when logging out an already-revoked token', async () => {
    const email = uniqueEmail('logout-twice');
    const registered = await registerCustomer(app, email, 'correct horse battery staple').expect(201);
    const refreshToken = (registered.body as AuthSessionBody).data.refreshToken;

    await request(app).post('/api/v1/identity/logout').send({ refreshToken }).expect(200);
    await request(app).post('/api/v1/identity/logout').send({ refreshToken }).expect(200);
  });
});
