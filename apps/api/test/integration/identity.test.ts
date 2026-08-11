import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
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

    it('answers a 429 with the same error envelope as every other failure (SDD 9.3)', async () => {
      const phone = uniquePhone();
      await requestOtp(app, phone).expect(200);

      const blocked = await requestOtp(app, phone).expect(429);

      // A short-circuited refusal used to be the one response shape that
      // carried no requestId — precisely the response a client most needs to
      // correlate to a log line.
      const body = blocked.body as ErrorBody & {
        error: { requestId?: string; timestamp?: string };
      };
      expect(body.error.code).toBe('RATE_LIMIT_EXCEEDED');
      expect(body.error.message).toEqual(expect.any(String));
      expect(body.error.requestId).toEqual(expect.any(String));
      expect(body.error.requestId).toBe(blocked.headers['x-request-id']);
      expect(new Date(body.error.timestamp ?? '').toISOString()).toBe(body.error.timestamp);
    });

    it('sends the rate-limit headers SDD 9.2 names', async () => {
      const phone = uniquePhone();
      await requestOtp(app, phone).expect(200);

      const blocked = await requestOtp(app, phone).expect(429);

      expect(blocked.headers['x-ratelimit-limit']).toBe('1');
      expect(blocked.headers['x-ratelimit-remaining']).toBe('0');
      expect(blocked.headers['x-ratelimit-reset']).toEqual(expect.any(String));
      expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
    });

    it('reports the remaining budget on a request that is still allowed', async () => {
      const response = await requestOtp(app, uniquePhone()).expect(200);

      expect(response.headers['x-ratelimit-limit']).toEqual(expect.any(String));
      expect(response.headers['x-ratelimit-remaining']).toEqual(expect.any(String));
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

    it('refuses an admin account on the customer OTP path (SDD 7.1)', async () => {
      // An administrator must never obtain a session without TOTP. No
      // production path can give an admin a phone today, so the state is
      // constructed directly — this asserts the guard that keeps the OTP
      // endpoint from becoming an MFA bypass if one ever can.
      const phone = uniquePhone();
      const email = uniqueEmail('otp-admin');
      const code = '135790';
      const userId = container.idGenerator.generate();

      await container.prisma.user.create({
        data: {
          id: userId,
          email,
          phone,
          role: 'SUPER_ADMIN',
          status: 'ACTIVE',
          passwordHash: 'hashed:not-a-real-password-hash-value',
        },
      });
      await container.prisma.otp.create({
        data: {
          id: container.idGenerator.generate(),
          userId,
          codeHash: await otpHasher.hash(code),
          expiresAt: new Date(Date.now() + 5 * 60_000),
        },
      });

      const response = await verifyOtp(app, phone, code).expect(400);

      // Identical to every other failure on this endpoint: an attacker
      // submitting phone numbers cannot identify an administrator (SEC-15).
      expect((response.body as ErrorBody).error.code).toBe('INVALID_OTP');

      // No session was issued, and the admin's OTP was left untouched.
      expect(await container.prisma.refreshToken.findMany({ where: { userId } })).toHaveLength(0);
      const otp = await container.prisma.otp.findFirstOrThrow({ where: { userId } });
      expect(otp.consumedAt).toBeNull();
      expect(otp.attempts).toBe(0);
    });

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

  describe('shut-out accounts (SDD 7.2)', () => {
    const PASSWORD = 'correct horse battery staple';

    /** Suspends/locks a registered account directly, as an admin action would. */
    const setStatus = async (email: string, status: 'SUSPENDED' | 'LOCKED'): Promise<void> => {
      await container.prisma.user.update({ where: { email }, data: { status } });
    };

    const registerAndShutOut = async (
      label: string,
      status: 'SUSPENDED' | 'LOCKED',
    ): Promise<{ email: string; refreshToken: string }> => {
      const email = uniqueEmail(label);
      const registered = await registerCustomer(app, email, PASSWORD).expect(201);
      const { refreshToken } = (registered.body as AuthSessionBody).data;
      await setStatus(email, status);
      return { email, refreshToken };
    };

    it('refuses login for a suspended account holding the correct password', async () => {
      const { email } = await registerAndShutOut('login-suspended', 'SUSPENDED');

      const response = await request(app)
        .post('/api/v1/identity/login')
        .send({ email, password: PASSWORD })
        .expect(403);

      expect((response.body as ErrorBody).error.code).toBe('ACCOUNT_SUSPENDED');
    });

    it('refuses login for a locked account holding the correct password', async () => {
      const { email } = await registerAndShutOut('login-locked', 'LOCKED');

      const response = await request(app)
        .post('/api/v1/identity/login')
        .send({ email, password: PASSWORD })
        .expect(403);

      expect((response.body as ErrorBody).error.code).toBe('ACCOUNT_LOCKED');
    });

    it('answers a wrong password with 401 even when the account is suspended (SEC-15)', async () => {
      // The status check sits after the password check precisely so this
      // endpoint never becomes a way to enumerate suspended accounts.
      const { email } = await registerAndShutOut('login-suspended-wrong-pw', 'SUSPENDED');

      const response = await request(app)
        .post('/api/v1/identity/login')
        .send({ email, password: 'definitely not the password' })
        .expect(401);

      expect((response.body as ErrorBody).error.code).toBe('INVALID_CREDENTIALS');
    });

    it('answers a wrong password with 401 even when the account is locked (SEC-15)', async () => {
      const { email } = await registerAndShutOut('login-locked-wrong-pw', 'LOCKED');

      const response = await request(app)
        .post('/api/v1/identity/login')
        .send({ email, password: 'definitely not the password' })
        .expect(401);

      expect((response.body as ErrorBody).error.code).toBe('INVALID_CREDENTIALS');
    });

    it('refuses to refresh a suspended account still holding a valid refresh token', async () => {
      // The gap SDD 7.2 names: revoking existing sessions bounds nothing if
      // the live refresh token keeps minting replacements.
      const { refreshToken } = await registerAndShutOut('refresh-suspended', 'SUSPENDED');

      const response = await request(app)
        .post('/api/v1/identity/refresh')
        .send({ refreshToken })
        .expect(403);

      expect((response.body as ErrorBody).error.code).toBe('ACCOUNT_SUSPENDED');
    });

    it('refuses to refresh a locked account still holding a valid refresh token', async () => {
      const { refreshToken } = await registerAndShutOut('refresh-locked', 'LOCKED');

      const response = await request(app)
        .post('/api/v1/identity/refresh')
        .send({ refreshToken })
        .expect(403);

      expect((response.body as ErrorBody).error.code).toBe('ACCOUNT_LOCKED');
    });

    it('still answers an unknown refresh token uniformly, whatever the account status', async () => {
      await registerAndShutOut('refresh-unknown-token', 'SUSPENDED');

      const response = await request(app)
        .post('/api/v1/identity/refresh')
        .send({ refreshToken: 'never-issued-token' })
        .expect(401);

      expect((response.body as ErrorBody).error.code).toBe('INVALID_REFRESH_TOKEN');
    });

    it('leaves an active account logging in and refreshing normally', async () => {
      const email = uniqueEmail('active-unaffected');
      const registered = await registerCustomer(app, email, PASSWORD).expect(201);
      const { refreshToken } = (registered.body as AuthSessionBody).data;

      await request(app)
        .post('/api/v1/identity/login')
        .send({ email, password: PASSWORD })
        .expect(200);
      await request(app).post('/api/v1/identity/refresh').send({ refreshToken }).expect(200);
    });
  });

  describe('session-bound access tokens and revocation (SDD 7.2)', () => {
    const PASSWORD = 'correct horse battery staple';

    const me = (accessToken: string): request.Test =>
      request(app).get('/api/v1/identity/me').set('Authorization', `Bearer ${accessToken}`);

    /** Reads the payload of a token the test already holds; never logged. */
    const payloadOf = (accessToken: string): Record<string, unknown> =>
      JSON.parse(
        Buffer.from(accessToken.split('.')[1] ?? '', 'base64url').toString('utf8'),
      ) as Record<string, unknown>;

    it('carries the full claim set SDD 7.2 requires', async () => {
      const registered = await registerCustomer(app, uniqueEmail('claims'), PASSWORD).expect(201);
      const { accessToken } = (registered.body as AuthSessionBody).data;

      const payload = payloadOf(accessToken);

      for (const claim of ['sub', 'sid', 'jti', 'role', 'iss', 'aud', 'exp', 'iat']) {
        expect(payload).toHaveProperty(claim);
      }
    });

    it('binds the token sid to the session actually persisted', async () => {
      const registered = await registerCustomer(app, uniqueEmail('sid-binding'), PASSWORD).expect(
        201,
      );
      const body = registered.body as AuthSessionBody;

      const sid = payloadOf(body.data.accessToken).sid as string;
      const stored = await container.prisma.refreshToken.findUnique({ where: { id: sid } });

      expect(stored).not.toBeNull();
      expect(stored?.userId).toBe(body.data.user.id);
    });

    it('login: the access token authenticates', async () => {
      const registered = await registerCustomer(app, uniqueEmail('live'), PASSWORD).expect(201);
      const { accessToken } = (registered.body as AuthSessionBody).data;

      await me(accessToken).expect(200);
    });

    it('logout: the same access token stops authenticating immediately', async () => {
      // The defect this chunk closes. Before the denylist, this token kept
      // working for the rest of its 10-minute life after logout.
      const registered = await registerCustomer(app, uniqueEmail('logout-denies'), PASSWORD).expect(
        201,
      );
      const { accessToken, refreshToken } = (registered.body as AuthSessionBody).data;
      await me(accessToken).expect(200);

      await request(app).post('/api/v1/identity/logout').send({ refreshToken }).expect(200);

      const response = await me(accessToken).expect(401);
      expect((response.body as ErrorBody).error.code).toBe('INVALID_ACCESS_TOKEN');
    });

    it('logout leaves an unrelated session authenticating', async () => {
      const victim = await registerCustomer(app, uniqueEmail('logout-mine'), PASSWORD).expect(201);
      const bystander = await registerCustomer(app, uniqueEmail('logout-other'), PASSWORD).expect(
        201,
      );
      const victimBody = (victim.body as AuthSessionBody).data;
      const bystanderBody = (bystander.body as AuthSessionBody).data;

      await request(app)
        .post('/api/v1/identity/logout')
        .send({ refreshToken: victimBody.refreshToken })
        .expect(200);

      await me(victimBody.accessToken).expect(401);
      await me(bystanderBody.accessToken).expect(200);
    });

    it('refresh-token reuse: the revoked family stops authenticating', async () => {
      const registered = await registerCustomer(app, uniqueEmail('reuse-denies'), PASSWORD).expect(
        201,
      );
      const first = (registered.body as AuthSessionBody).data;

      const rotated = await request(app)
        .post('/api/v1/identity/refresh')
        .send({ refreshToken: first.refreshToken })
        .expect(200);
      const second = (rotated.body as AuthSessionBody).data;
      await me(second.accessToken).expect(200);

      // Replaying the already-rotated token is definitionally theft (SDD 7.2).
      await request(app)
        .post('/api/v1/identity/refresh')
        .send({ refreshToken: first.refreshToken })
        .expect(401);

      const response = await me(second.accessToken).expect(401);
      expect((response.body as ErrorBody).error.code).toBe('INVALID_ACCESS_TOKEN');
    });

    it('reuse detection leaves a different device session authenticating', async () => {
      const email = uniqueEmail('reuse-bystander');
      const registered = await registerCustomer(app, email, PASSWORD).expect(201);
      const deviceA = (registered.body as AuthSessionBody).data;

      // A second login roots a separate family, i.e. a second device.
      const secondLogin = await request(app)
        .post('/api/v1/identity/login')
        .send({ email, password: PASSWORD })
        .expect(200);
      const deviceB = (secondLogin.body as AuthSessionBody).data;

      await request(app)
        .post('/api/v1/identity/refresh')
        .send({ refreshToken: deviceA.refreshToken })
        .expect(200);
      await request(app)
        .post('/api/v1/identity/refresh')
        .send({ refreshToken: deviceA.refreshToken })
        .expect(401);

      await me(deviceB.accessToken).expect(200);
    });

    it('reuse detection also stops the replayed session\u2019s own access token', async () => {
      // The rotated-away session is already revoked in the database, so it is
      // not part of what family revocation "kills" \u2014 but its access token is
      // still live and is the one a thief is most likely to be holding.
      const registered = await registerCustomer(
        app,
        uniqueEmail('reuse-replayed'),
        PASSWORD,
      ).expect(201);
      const first = (registered.body as AuthSessionBody).data;

      await request(app)
        .post('/api/v1/identity/refresh')
        .send({ refreshToken: first.refreshToken })
        .expect(200);
      // The outgoing session's access token is still valid at this point.
      await me(first.accessToken).expect(200);

      await request(app)
        .post('/api/v1/identity/refresh')
        .send({ refreshToken: first.refreshToken })
        .expect(401);

      const response = await me(first.accessToken).expect(401);
      expect((response.body as ErrorBody).error.code).toBe('INVALID_ACCESS_TOKEN');
    });

    it('an ordinary rotation does not revoke the outgoing access token', async () => {
      // Rotation is legitimate: the same holder receives the replacement.
      const registered = await registerCustomer(app, uniqueEmail('rotate-ok'), PASSWORD).expect(
        201,
      );
      const first = (registered.body as AuthSessionBody).data;

      const rotated = await request(app)
        .post('/api/v1/identity/refresh')
        .send({ refreshToken: first.refreshToken })
        .expect(200);

      await me((rotated.body as AuthSessionBody).data.accessToken).expect(200);
      await me(first.accessToken).expect(200);
    });

    it('rejects a token minted for a different audience', async () => {
      const registered = await registerCustomer(app, uniqueEmail('aud'), PASSWORD).expect(201);
      const { user } = (registered.body as AuthSessionBody).data;
      const foreign = jwt.sign(
        { role: 'CUSTOMER', sid: '00000000-0000-7000-8000-0000000000ff' },
        container.env.JWT_ACCESS_SECRET,
        {
          subject: user.id,
          issuer: container.env.SERVICE_NAME,
          audience: 'some-other-audience',
          jwtid: '00000000-0000-7000-8000-0000000000fe',
          expiresIn: 600,
        },
      );

      const response = await me(foreign).expect(401);
      expect((response.body as ErrorBody).error.code).toBe('INVALID_ACCESS_TOKEN');
    });

    it('stops denying once the denylist entry expires', async () => {
      const registered = await registerCustomer(app, uniqueEmail('expiry'), PASSWORD).expect(201);
      const { accessToken, refreshToken } = (registered.body as AuthSessionBody).data;
      const sid = payloadOf(accessToken).sid as string;

      await request(app).post('/api/v1/identity/logout').send({ refreshToken }).expect(200);
      await me(accessToken).expect(401);

      // Expire the entry directly rather than waiting out the TTL. In
      // production the access token has outlived its own `exp` by this point,
      // so the denylist has nothing left to protect.
      await container.redis.del(`denied-session:${sid}`);

      // The token is still within its 10-minute life here, which is what
      // makes this a real assertion that the denial lapsed.
      await me(accessToken).expect(200);
    });
  });

  describe('request context capture (SDD 18.4)', () => {
    const PASSWORD = 'correct horse battery staple';

    it('still returns requestId in the success envelope', async () => {
      // The pre-existing consumer of the request context. Adding `ip` and
      // `userAgent` alongside it must not disturb what SDD 9.3 puts on the wire.
      const response = await registerCustomer(app, uniqueEmail('ctx-success'), PASSWORD).expect(
        201,
      );

      const body = response.body as { meta?: { requestId?: string } };
      expect(body.meta?.requestId).toEqual(expect.any(String) as unknown as string);
    });

    it('still returns requestId in the error envelope', async () => {
      const response = await request(app)
        .post('/api/v1/identity/login')
        .send({ email: 'not-an-email' })
        .expect(400);

      expect((response.body as { error: { requestId: string } }).error.requestId).toEqual(
        expect.any(String) as unknown as string,
      );
    });

    it('never leaks the captured IP or user agent into a success response', async () => {
      const response = await registerCustomer(app, uniqueEmail('ctx-leak'), PASSWORD)
        .set('User-Agent', 'leen-mart-leak-probe/1.0')
        .set('X-Forwarded-For', '203.0.113.7')
        .expect(201);

      const serialised = JSON.stringify(response.body);
      expect(serialised).not.toContain('leen-mart-leak-probe');
      expect(serialised).not.toContain('203.0.113.7');
      expect(serialised).not.toContain('userAgent');
      expect(serialised).not.toMatch(/"ip"/);
    });

    it('never leaks the captured IP or user agent into an error response', async () => {
      const response = await request(app)
        .post('/api/v1/identity/login')
        .set('User-Agent', 'leen-mart-leak-probe/1.0')
        .set('X-Forwarded-For', '203.0.113.7')
        .send({ email: 'not-an-email' })
        .expect(400);

      const serialised = JSON.stringify(response.body);
      expect(serialised).not.toContain('leen-mart-leak-probe');
      expect(serialised).not.toContain('203.0.113.7');
      expect(serialised).not.toContain('userAgent');
    });

    it('leaves authentication unchanged when a user agent is supplied', async () => {
      const registered = await registerCustomer(app, uniqueEmail('ctx-auth'), PASSWORD)
        .set('User-Agent', 'leen-mart-auth-probe/1.0')
        .expect(201);
      const { accessToken } = (registered.body as AuthSessionBody).data;

      await request(app)
        .get('/api/v1/identity/me')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('User-Agent', 'leen-mart-auth-probe/1.0')
        .expect(200);
    });

    it('leaves authentication unchanged when no user agent is supplied', async () => {
      // The null-user-agent path must not affect anything on the request.
      const email = uniqueEmail('ctx-no-ua');
      const registered = await registerCustomer(app, email, PASSWORD).expect(201);
      const { accessToken } = (registered.body as AuthSessionBody).data;

      const response = await request(app)
        .get('/api/v1/identity/me')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect((response.body as MeBody).data.id).toEqual(expect.any(String) as unknown as string);
    });

    it('leaves the rate-limit contract unchanged', async () => {
      // The limiter derives its own IP key independently of the request
      // context; capturing the IP here must not have disturbed it.
      const response = await request(app)
        .post('/api/v1/identity/login')
        .set('User-Agent', 'leen-mart-rl-probe/1.0')
        .send({ email: uniqueEmail('ctx-rl'), password: PASSWORD })
        .expect(401);

      expect(response.headers['x-ratelimit-limit']).toBeDefined();
      expect(response.headers['x-ratelimit-remaining']).toBeDefined();
    });
  });
});
