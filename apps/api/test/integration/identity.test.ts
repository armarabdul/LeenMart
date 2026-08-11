import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createApp } from '../../src/app.js';
import { type Container, createContainer } from '../../src/container.js';
import { Argon2OtpHasher } from '../../src/modules/identity/infrastructure/security/argon2-otp-hasher.js';

interface AuthSessionBody {
  data: {
    user: { id: string; email?: string; role: string };
    accessToken: string;
    accessTokenExpiresAt: string;
    refreshToken: string;
    refreshTokenExpiresAt: string;
  };
}

interface ErrorBody {
  error: { code: string; message: string };
}

interface MeBody {
  data: { id: string; role: string };
}

const EMAIL_PREFIX = 'identity-integration-';
const PHONE_PREFIX = '+9197';

const uniqueEmail = (label: string): string =>
  `${EMAIL_PREFIX}${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;

let phoneSeq = 0;
const uniquePhone = (): string => {
  phoneSeq += 1;
  return `${PHONE_PREFIX}${(10_000_000 + phoneSeq).toString().padStart(8, '0')}`;
};

const registerCustomer = (app: Express, email: string, password: string): request.Test =>
  request(app).post('/api/v1/identity/register').send({ email, password });

/** Drops every rate-limit bucket so a run never inherits another run's counters. */
const clearRateLimitKeys = async (container: Container): Promise<void> => {
  const keys = await container.redis.keys('rl:*');
  if (keys.length > 0) await container.redis.del(...keys);
};

const requestOtp = (app: Express, phone: string): request.Test =>
  request(app).post('/api/v1/identity/otp/request').send({ phone });

const verifyOtp = (app: Express, phone: string, code: string): request.Test =>
  request(app).post('/api/v1/identity/otp/verify').send({ phone, code });

/**
 * Integration test against real PostgreSQL (SDD README §"Conventions for the
 * first business module"). Requires `pnpm infra:up` and an applied migration.
 * Not mocked: rotation and uniqueness constraints are exactly what this suite
 * exists to prove.
 */
describe('identity endpoints', () => {
  let container: Container;
  let app: Express;

  beforeAll(async () => {
    process.env.ENV_FILE = '.env.test';
    container = createContainer();
    app = createApp(container);
    // SDD 23.3's per-IP budgets are counted in Redis, which outlives a test
    // run. Without clearing them, the hour-long windows accumulate across
    // repeated runs and the suite starts failing on its third pass for
    // reasons that have nothing to do with the code under test.
    await clearRateLimitKeys(container);
  });

  // Every test starts with a clean budget, so no test can be pushed over a
  // ceiling by whatever ran before it. Counters still accumulate *within* a
  // test, which is exactly what the rate-limit cases below rely on.
  beforeEach(async () => {
    await clearRateLimitKeys(container);
  });

  afterAll(async () => {
    await container.prisma.user.deleteMany({ where: { email: { contains: EMAIL_PREFIX } } });
    await container.prisma.user.deleteMany({ where: { phone: { startsWith: PHONE_PREFIX } } });
    await clearRateLimitKeys(container);
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

    const response = await request(app)
      .post('/api/v1/identity/login')
      .send({ email, password })
      .expect(200);

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
    const registered = await registerCustomer(app, email, 'correct horse battery staple').expect(
      201,
    );
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

  it('revokes the whole session family when a rotated-away token is replayed (SDD 7.2)', async () => {
    const email = uniqueEmail('reuse-family');
    const registered = await registerCustomer(app, email, 'correct horse battery staple').expect(
      201,
    );
    const r1 = (registered.body as AuthSessionBody).data.refreshToken;

    // R1 → R2. R2 is the live token a thief would be holding after refreshing
    // ahead of the victim.
    const rotated = await request(app)
      .post('/api/v1/identity/refresh')
      .send({ refreshToken: r1 })
      .expect(200);
    const r2 = (rotated.body as AuthSessionBody).data.refreshToken;

    // Replaying R1 is definitionally theft: the holder of R1 should already
    // have exchanged it.
    const replay = await request(app)
      .post('/api/v1/identity/refresh')
      .send({ refreshToken: r1 })
      .expect(401);
    expect((replay.body as ErrorBody).error.code).toBe('INVALID_REFRESH_TOKEN');

    // The point of the chunk: R2 died with the rest of its family, so the
    // compromise is bounded rather than permanent.
    const r2AfterReplay = await request(app)
      .post('/api/v1/identity/refresh')
      .send({ refreshToken: r2 })
      .expect(401);
    expect((r2AfterReplay.body as ErrorBody).error.code).toBe('INVALID_REFRESH_TOKEN');

    // Every row in that family is revoked in the database, not just rejected.
    const rows = await container.prisma.refreshToken.findMany({
      where: { user: { email } },
      select: { familyId: true, revokedAt: true },
    });
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((row) => row.familyId)).size).toBe(1);
    expect(rows.every((row) => row.revokedAt !== null)).toBe(true);
  });

  it('keeps a separate login alive when another family is compromised (SDD 7.2)', async () => {
    const email = uniqueEmail('two-devices');
    const password = 'correct horse battery staple';
    const registered = await registerCustomer(app, email, password).expect(201);
    const deviceA1 = (registered.body as AuthSessionBody).data.refreshToken;

    // A second login is a second family — the same user on another device.
    const secondLogin = await request(app)
      .post('/api/v1/identity/login')
      .send({ email, password })
      .expect(200);
    const deviceB1 = (secondLogin.body as AuthSessionBody).data.refreshToken;

    await request(app)
      .post('/api/v1/identity/refresh')
      .send({ refreshToken: deviceA1 })
      .expect(200);
    await request(app)
      .post('/api/v1/identity/refresh')
      .send({ refreshToken: deviceA1 })
      .expect(401);

    // Device B is untouched: SDD 7.2 revokes a family, not a user. Signing a
    // user out everywhere is a different trigger (suspension, password change,
    // "log out all devices").
    await request(app)
      .post('/api/v1/identity/refresh')
      .send({ refreshToken: deviceB1 })
      .expect(200);

    const families = await container.prisma.refreshToken.groupBy({
      by: ['familyId'],
      where: { user: { email } },
      _count: { _all: true },
    });
    expect(families).toHaveLength(2);
  });

  describe('rate-limit budgets (SDD 23.3)', () => {
    it('caps login at 5 per minute for one identity, without leaking whether it exists', async () => {
      const email = uniqueEmail('login-budget');
      const password = 'correct horse battery staple';
      await registerCustomer(app, email, password).expect(201);

      // Five wrong-password attempts are the whole per-identity budget.
      for (let attempt = 0; attempt < 5; attempt += 1) {
        await request(app)
          .post('/api/v1/identity/login')
          .send({ email, password: 'wrong password' })
          .expect(401);
      }

      // The sixth is refused by the limiter — even with the *correct*
      // password, which is what makes this a brute-force ceiling rather than
      // a failed-attempt counter.
      const blocked = await request(app)
        .post('/api/v1/identity/login')
        .send({ email, password })
        .expect(429);
      expect((blocked.body as ErrorBody).error.code).toBe('RATE_LIMIT_EXCEEDED');
    });

    it('scopes the login budget to one identity, so exhausting it cannot lock out others', async () => {
      const victim = uniqueEmail('login-victim');
      const bystander = uniqueEmail('login-bystander');
      const password = 'correct horse battery staple';
      await registerCustomer(app, victim, password).expect(201);
      await registerCustomer(app, bystander, password).expect(201);

      for (let attempt = 0; attempt < 6; attempt += 1) {
        await request(app)
          .post('/api/v1/identity/login')
          .send({ email: victim, password: 'wrong password' });
      }

      await request(app)
        .post('/api/v1/identity/login')
        .send({ email: bystander, password })
        .expect(200);
    });

    it('caps OTP requests at 1 per minute for one phone, protecting SMS spend', async () => {
      const phone = uniquePhone();

      await requestOtp(app, phone).expect(200);

      const blocked = await requestOtp(app, phone).expect(429);
      expect((blocked.body as ErrorBody).error.code).toBe('RATE_LIMIT_EXCEEDED');
    });

    it('scopes the OTP budget to one phone', async () => {
      const first = uniquePhone();
      const second = uniquePhone();

      await requestOtp(app, first).expect(200);
      await requestOtp(app, first).expect(429);

      await requestOtp(app, second).expect(200);
    });

    it('caps refresh at 10 per minute for one session', async () => {
      const email = uniqueEmail('refresh-budget');
      const registered = await registerCustomer(app, email, 'correct horse battery staple').expect(
        201,
      );
      const refreshToken = (registered.body as AuthSessionBody).data.refreshToken;

      // The same token, replayed. Every call after the first is a rejected
      // reuse, but the limiter counts attempts rather than successes — a
      // limiter that only counted successes would not bound an attacker.
      for (let attempt = 0; attempt < 10; attempt += 1) {
        await request(app).post('/api/v1/identity/refresh').send({ refreshToken });
      }

      const blocked = await request(app)
        .post('/api/v1/identity/refresh')
        .send({ refreshToken })
        .expect(429);
      expect((blocked.body as ErrorBody).error.code).toBe('RATE_LIMIT_EXCEEDED');
    });

    it('counts malformed requests too, so the limiter cannot be bypassed by sending junk', async () => {
      const email = uniqueEmail('login-malformed');

      // No password at all: `validate()` would reject these with a 400, but
      // the limiter runs first and still charges them to the identity.
      for (let attempt = 0; attempt < 5; attempt += 1) {
        await request(app).post('/api/v1/identity/login').send({ email }).expect(400);
      }

      await request(app)
        .post('/api/v1/identity/login')
        .send({ email, password: 'correct horse battery staple' })
        .expect(429);
    });

    it('leaves unbudgeted endpoints alone', async () => {
      // SDD 23.3 gives `register` and `logout` no per-endpoint budget; only the
      // global 1,000/min ceiling applies.
      for (let attempt = 0; attempt < 8; attempt += 1) {
        await registerCustomer(
          app,
          uniqueEmail(`unbudgeted-${attempt}`),
          'correct horse battery',
        ).expect(201);
      }
    });
  });

  it('logs out and invalidates the refresh token', async () => {
    const email = uniqueEmail('logout');
    const registered = await registerCustomer(app, email, 'correct horse battery staple').expect(
      201,
    );
    const refreshToken = (registered.body as AuthSessionBody).data.refreshToken;

    await request(app).post('/api/v1/identity/logout').send({ refreshToken }).expect(200);

    const response = await request(app)
      .post('/api/v1/identity/refresh')
      .send({ refreshToken })
      .expect(401);
    expect((response.body as ErrorBody).error.code).toBe('INVALID_REFRESH_TOKEN');
  });

  it('is idempotent when logging out an already-revoked token', async () => {
    const email = uniqueEmail('logout-twice');
    const registered = await registerCustomer(app, email, 'correct horse battery staple').expect(
      201,
    );
    const refreshToken = (registered.body as AuthSessionBody).data.refreshToken;

    await request(app).post('/api/v1/identity/logout').send({ refreshToken }).expect(200);
    await request(app).post('/api/v1/identity/logout').send({ refreshToken }).expect(200);
  });

  describe('phone OTP endpoints', () => {
    const otpHasher = new Argon2OtpHasher();

    /**
     * The real OTP is generated with a CSPRNG and never returned, logged, or
     * persisted anywhere in plaintext (by design — SEC-09). To exercise the
     * success path through real HTTP + Postgres, this seeds a *known* code
     * directly via Prisma, using the same `Argon2OtpHasher` production code
     * uses, mirroring the direct-repository fixture technique already
     * established in `prisma-otp.repository.test.ts`. No production code
     * path is altered or bypassed to make this possible.
     */
    const seedKnownOtp = async (
      phone: string,
      code: string,
      overrides: { expiresAt?: Date } = {},
    ): Promise<void> => {
      const user = await container.prisma.user.findUniqueOrThrow({ where: { phone } });
      await container.prisma.otp.deleteMany({ where: { userId: user.id } });
      await container.prisma.otp.create({
        data: {
          id: container.idGenerator.generate(),
          userId: user.id,
          codeHash: await otpHasher.hash(code),
          expiresAt: overrides.expiresAt ?? new Date(Date.now() + 5 * 60_000),
        },
      });
    };

    it('requests an OTP and creates a pending customer for a new phone', async () => {
      const phone = uniquePhone();

      const response = await requestOtp(app, phone).expect(200);

      expect(response.body).toEqual({
        data: { success: true },
        meta: { requestId: expect.any(String) as unknown as string },
      });
      const user = await container.prisma.user.findUniqueOrThrow({ where: { phone } });
      expect(user.status).toBe('PENDING');
      expect(user.phoneVerifiedAt).toBeNull();
    });

    it('does not create a duplicate user when requesting OTP for an existing phone', async () => {
      const phone = uniquePhone();

      await requestOtp(app, phone).expect(200);
      // SDD 23.3 caps this phone at 1 OTP/min, and that cap is not what this
      // test is about: the invariant under test is that the *use case* reuses
      // the existing account instead of creating a second one. Clearing the
      // budget keeps that invariant testable without relaxing the production
      // ceiling.
      await clearRateLimitKeys(container);
      await requestOtp(app, phone).expect(200);

      const users = await container.prisma.user.findMany({ where: { phone } });
      expect(users).toHaveLength(1);
    });

    it('rejects a malformed phone number', async () => {
      await requestOtp(app, '12345').expect(400);
    });

    it('never exposes the plaintext OTP in the request response', async () => {
      const phone = uniquePhone();

      const response = await requestOtp(app, phone).expect(200);

      expect(JSON.stringify(response.body)).not.toMatch(/"\d{6}"/);
    });

    it('verifies a valid OTP, activates the customer, and issues a session', async () => {
      const phone = uniquePhone();
      await requestOtp(app, phone).expect(200);
      await seedKnownOtp(phone, '123456');

      const response = await verifyOtp(app, phone, '123456').expect(200);

      const body = response.body as AuthSessionBody;
      expect(body.data.accessToken).toEqual(expect.any(String));
      expect(body.data.refreshToken).toEqual(expect.any(String));
      expect(body.data.user.role).toBe('CUSTOMER');

      const user = await container.prisma.user.findUniqueOrThrow({ where: { phone } });
      expect(user.status).toBe('ACTIVE');
      expect(user.phoneVerifiedAt).not.toBeNull();
    });

    it('rejects a wrong OTP code without revealing which part was wrong', async () => {
      const phone = uniquePhone();
      await requestOtp(app, phone).expect(200);
      await seedKnownOtp(phone, '123456');

      const response = await verifyOtp(app, phone, '999999').expect(400);

      expect((response.body as ErrorBody).error.code).toBe('INVALID_OTP');
    });

    it('rejects an unknown phone with the same uniform error as a wrong code', async () => {
      const response = await verifyOtp(app, uniquePhone(), '123456').expect(400);

      expect((response.body as ErrorBody).error.code).toBe('INVALID_OTP');
    });

    it('rejects a malformed OTP code before it reaches the use case', async () => {
      const phone = uniquePhone();
      await requestOtp(app, phone).expect(200);

      const response = await verifyOtp(app, phone, '42').expect(400);

      expect((response.body as ErrorBody).error.code).toBe('VALIDATION_FAILED');
    });

    it('rejects an expired OTP', async () => {
      const phone = uniquePhone();
      await requestOtp(app, phone).expect(200);
      await seedKnownOtp(phone, '123456', { expiresAt: new Date(Date.now() - 60_000) });

      const response = await verifyOtp(app, phone, '123456').expect(401);

      expect((response.body as ErrorBody).error.code).toBe('EXPIRED_OTP');
    });
  });

  describe('GET /me', () => {
    it('returns the authenticated caller for a valid access token', async () => {
      const email = uniqueEmail('me');
      const registered = await registerCustomer(app, email, 'correct horse battery staple').expect(
        201,
      );
      const session = registered.body as AuthSessionBody;

      const response = await request(app)
        .get('/api/v1/identity/me')
        .set('Authorization', `Bearer ${session.data.accessToken}`)
        .expect(200);

      const body = response.body as MeBody;
      expect(body.data.id).toBe(session.data.user.id);
      expect(body.data.role).toBe('CUSTOMER');
    });

    it('rejects a request with no Authorization header', async () => {
      const response = await request(app).get('/api/v1/identity/me').expect(401);

      expect((response.body as ErrorBody).error.code).toBe('INVALID_ACCESS_TOKEN');
    });

    it('rejects a request with an invalid access token', async () => {
      const response = await request(app)
        .get('/api/v1/identity/me')
        .set('Authorization', 'Bearer not-a-real-token')
        .expect(401);

      expect((response.body as ErrorBody).error.code).toBe('INVALID_ACCESS_TOKEN');
    });

    it('rejects a non-Bearer Authorization scheme', async () => {
      const response = await request(app)
        .get('/api/v1/identity/me')
        .set('Authorization', 'Basic dXNlcjpwYXNz')
        .expect(401);

      expect((response.body as ErrorBody).error.code).toBe('INVALID_ACCESS_TOKEN');
    });

    it('does not accept a refresh token in place of an access token', async () => {
      const email = uniqueEmail('me-refresh-token');
      const registered = await registerCustomer(app, email, 'correct horse battery staple').expect(
        201,
      );
      const session = registered.body as AuthSessionBody;

      const response = await request(app)
        .get('/api/v1/identity/me')
        .set('Authorization', `Bearer ${session.data.refreshToken}`)
        .expect(401);

      expect((response.body as ErrorBody).error.code).toBe('INVALID_ACCESS_TOKEN');
    });
  });
});
