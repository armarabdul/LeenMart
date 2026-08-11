import { describe, expect, it } from 'vitest';
import { FixedClock, UuidV4Generator } from '@leen-mart/domain-kit';
import { SessionIssuer } from '../../../../../src/modules/identity/application/services/session-issuer.service.js';
import { User } from '../../../../../src/modules/identity/domain/entities/user.entity.js';
import {
  ADMIN_ROLE_NAMES,
  Role,
  type RoleName,
} from '../../../../../src/modules/identity/domain/value-objects/role.value-object.js';
import { PasswordHash } from '../../../../../src/modules/identity/domain/value-objects/password-hash.value-object.js';
import { UserStatus } from '../../../../../src/modules/identity/domain/value-objects/user-status.value-object.js';
import { toUserId } from '../../../../../src/modules/identity/domain/value-objects/user-id.value-object.js';
import {
  FakeAccessTokenService,
  InMemoryRefreshTokenRepository,
  SequentialRefreshTokenHasher,
} from './fakes.js';

const NOW = new Date('2026-01-01T00:00:00.000Z');
const MINUTE_MS = 60 * 1000;
const DAY_MS = 24 * 60 * MINUTE_MS;

const setup = (): {
  issuer: SessionIssuer;
  clock: FixedClock;
  repository: InMemoryRefreshTokenRepository;
  accessTokenService: FakeAccessTokenService;
} => {
  const clock = new FixedClock(NOW);
  const repository = new InMemoryRefreshTokenRepository();
  const accessTokenService = new FakeAccessTokenService({
    token: 'access-token',
    expiresAt: new Date('2026-01-01T00:10:00.000Z'),
  });
  const issuer = new SessionIssuer({
    accessTokenService,
    refreshTokenHasher: new SequentialRefreshTokenHasher(),
    refreshTokenRepository: repository,
    idGenerator: new UuidV4Generator(),
    clock,
    refreshTtlDays: 30,
    adminIdleTimeoutMinutes: 30,
  });
  return { issuer, clock, repository, accessTokenService };
};

const userWithRole = (roleName: RoleName): User =>
  User.reconstitute({
    id: toUserId('00000000-0000-7000-8000-0000000000c1'),
    email: `${roleName.toLowerCase()}@leenmart.in`,
    passwordHash: PasswordHash.create('hashed:not-a-real-hash'),
    role: Role.fromName(roleName),
    status: UserStatus.ACTIVE,
    createdAt: NOW,
    updatedAt: NOW,
  });

const NON_ADMIN_ROLES: readonly RoleName[] = [
  'CUSTOMER',
  'VENDOR_OWNER',
  'VENDOR_MANAGER',
  'VENDOR_STAFF',
];

describe('SessionIssuer', () => {
  describe('admin idle timeout (SDD 7.5)', () => {
    it.each(ADMIN_ROLE_NAMES)('gives %s a 30-minute refresh window', async (roleName) => {
      const { issuer } = setup();

      const session = await issuer.issueFor(userWithRole(roleName));

      expect(session.refreshTokenExpiresAt).toEqual(new Date(NOW.getTime() + 30 * MINUTE_MS));
    });

    it.each(NON_ADMIN_ROLES)(
      'leaves %s on the 30-day sliding window (SDD 7.2)',
      async (roleName) => {
        const { issuer } = setup();

        const session = await issuer.issueFor(userWithRole(roleName));

        expect(session.refreshTokenExpiresAt).toEqual(new Date(NOW.getTime() + 30 * DAY_MS));
      },
    );

    it('honours a configured timeout rather than a hard-coded 30 minutes', async () => {
      const clock = new FixedClock(NOW);
      const issuer = new SessionIssuer({
        accessTokenService: new FakeAccessTokenService({
          token: 'access-token',
          expiresAt: new Date('2026-01-01T00:10:00.000Z'),
        }),
        refreshTokenHasher: new SequentialRefreshTokenHasher(),
        refreshTokenRepository: new InMemoryRefreshTokenRepository(),
        idGenerator: new UuidV4Generator(),
        clock,
        refreshTtlDays: 30,
        adminIdleTimeoutMinutes: 5,
      });

      const session = await issuer.issueFor(userWithRole('SUPER_ADMIN'));

      expect(session.refreshTokenExpiresAt).toEqual(new Date(NOW.getTime() + 5 * MINUTE_MS));
    });

    it('slides the window on every rotation, which is what makes it an idle timeout', async () => {
      const { issuer, clock } = setup();
      const admin = userWithRole('SUPER_ADMIN');

      const first = await issuer.issueFor(admin);
      // The admin keeps working: a rotation well inside the window.
      clock.advanceMs(20 * MINUTE_MS);
      const rotated = await issuer.issueFor(admin, first.refreshTokenFamilyId);

      expect(rotated.refreshTokenExpiresAt).toEqual(
        new Date(NOW.getTime() + 20 * MINUTE_MS + 30 * MINUTE_MS),
      );
      expect(rotated.refreshTokenExpiresAt.getTime()).toBeGreaterThan(
        first.refreshTokenExpiresAt.getTime(),
      );
    });

    it('persists the shortened expiry, so the window is enforced by stored state', async () => {
      const { issuer, repository } = setup();

      const session = await issuer.issueFor(userWithRole('RISK_ANALYST'));

      const stored = repository.all().find((token) => token.id === session.refreshTokenId);
      expect(stored?.expiresAt).toEqual(new Date(NOW.getTime() + 30 * MINUTE_MS));
      expect(stored?.isActive(new Date(NOW.getTime() + 29 * MINUTE_MS))).toBe(true);
      expect(stored?.isActive(new Date(NOW.getTime() + 30 * MINUTE_MS))).toBe(false);
    });

    it('keeps the rotation lineage intact when the window is shortened', async () => {
      const { issuer } = setup();
      const admin = userWithRole('FINANCE_ADMIN');

      const first = await issuer.issueFor(admin);
      const rotated = await issuer.issueFor(admin, first.refreshTokenFamilyId);

      expect(rotated.refreshTokenFamilyId).toBe(first.refreshTokenFamilyId);
    });
  });

  describe('session binding (SDD 7.2)', () => {
    it('signs the access token with the sid of the session it persists', async () => {
      // `sid` is what revocation keys on: if the token named a different
      // session than the one stored, denying that session would have no
      // effect on the token it issued.
      const { issuer, repository, accessTokenService } = setup();

      const session = await issuer.issueFor(userWithRole('CUSTOMER'));

      const [persisted] = repository.all();
      expect(persisted).toBeDefined();
      expect(accessTokenService.signed).toHaveLength(1);
      expect(accessTokenService.signed[0]?.sid).toBe(persisted?.id);
      expect(session.refreshTokenId).toBe(persisted?.id);
    });

    it('signs each new session with its own distinct sid', async () => {
      const { issuer, accessTokenService } = setup();
      const user = userWithRole('CUSTOMER');

      await issuer.issueFor(user);
      await issuer.issueFor(user);

      const sids = accessTokenService.signed.map((subject) => subject.sid);
      expect(new Set(sids).size).toBe(2);
    });

    it('signs the token with the subject and role of the user it is issued for', async () => {
      const { issuer, accessTokenService } = setup();
      const user = userWithRole('SUPER_ADMIN');

      await issuer.issueFor(user);

      expect(accessTokenService.signed[0]?.sub).toBe(user.id);
      expect(accessTokenService.signed[0]?.role).toBe('SUPER_ADMIN');
    });

    it('still continues the family it is handed, unchanged by sid binding', async () => {
      const { issuer, repository } = setup();
      const user = userWithRole('CUSTOMER');
      const first = await issuer.issueFor(user);

      const second = await issuer.issueFor(user, first.refreshTokenFamilyId);

      expect(second.refreshTokenFamilyId).toBe(first.refreshTokenFamilyId);
      expect(second.refreshTokenId).not.toBe(first.refreshTokenId);
      expect(repository.all()).toHaveLength(2);
    });
  });
});
