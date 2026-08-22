import { describe, expect, it } from 'vitest';
import { FixedClock, NullLogger } from '@leen-mart/domain-kit';
import { InMemoryRefreshTokenRepository } from '../../../modules/identity/application/fakes.js';
import { Session } from '../../../../../src/modules/identity/domain/entities/session.entity.js';
import { toSessionId } from '../../../../../src/modules/identity/domain/value-objects/session-id.value-object.js';
import { toUserId } from '../../../../../src/modules/identity/domain/value-objects/user-id.value-object.js';
import type { SessionId } from '../../../../../src/modules/identity/domain/value-objects/session-id.value-object.js';
import type { UserId } from '../../../../../src/modules/identity/domain/value-objects/user-id.value-object.js';
import { revokeEverySession } from '../../../../../src/shared/application/services/revoke-every-session.js';

const NOW = new Date('2026-01-01T00:00:00.000Z');
const ACCESS_TTL = 600;
const userId = toUserId('00000000-0000-7000-8000-0000000000d1');

const seedSessions = (
  sessionRepository: InMemoryRefreshTokenRepository,
  forUserId: UserId,
): SessionId[] => {
  const ids = [
    toSessionId('00000000-0000-7000-8000-00000000f5d0'),
    toSessionId('00000000-0000-7000-8000-00000000f5d1'),
  ];
  for (const id of ids) {
    void sessionRepository.create(
      Session.reconstitute({
        id,
        userId: forUserId,
        familyId: id,
        tokenHash: `hash-${id}`,
        expiresAt: new Date(NOW.getTime() + 86_400_000),
        revokedAt: null,
        replacedByTokenId: null,
        createdAt: NOW,
      }),
    );
  }
  return ids;
};

const setup = (): {
  sessionRepository: InMemoryRefreshTokenRepository;
  denied: { id: SessionId; ttl: number }[];
  run: (forUserId: UserId) => Promise<void>;
} => {
  const sessionRepository = new InMemoryRefreshTokenRepository();
  const denied: { id: SessionId; ttl: number }[] = [];

  return {
    sessionRepository,
    denied,
    run: (forUserId: UserId) =>
      revokeEverySession(
        {
          sessionRepository,
          sessionDenylist: {
            deny: (id: SessionId, ttl: number) => {
              denied.push({ id, ttl });
              return Promise.resolve();
            },
            isDenied: () => Promise.resolve(false),
          },
          accessTokenTtlSeconds: ACCESS_TTL,
          logger: new NullLogger(),
        },
        forUserId,
        new FixedClock(NOW).now(),
      ),
  };
};

/**
 * Direct unit coverage for the extracted service (Phase L.4) — previously
 * exercised only indirectly through `RegisterVendorUseCase`'s own "session
 * revocation" suite, which still passes unchanged and proves the extraction
 * altered no behaviour there. This suite is the service's own, now that it
 * has a second caller (`SuspendVendorUseCase`).
 */
describe('revokeEverySession', () => {
  it('revokes every session the account holds, across families', async () => {
    const { sessionRepository, run } = setup();
    const ids = seedSessions(sessionRepository, userId);

    await run(userId);

    const live = await sessionRepository.revokeAllForUser(userId, NOW);
    expect(live).toEqual([]);
    expect(await sessionRepository.findSessionIdsByUserId(userId)).toHaveLength(ids.length);
  });

  it('denies every session id, not just the ones it killed', async () => {
    const { sessionRepository, run, denied } = setup();
    const ids = seedSessions(sessionRepository, userId);

    await run(userId);

    expect(new Set(denied.map((entry) => entry.id))).toEqual(new Set(ids));
  });

  it('denies each session for exactly the access-token lifetime', async () => {
    const { sessionRepository, run, denied } = setup();
    seedSessions(sessionRepository, userId);

    await run(userId);

    expect(denied).not.toHaveLength(0);
    expect(denied.every((entry) => entry.ttl === ACCESS_TTL)).toBe(true);
  });

  it('does not revoke sessions belonging to another account', async () => {
    const other = toUserId('00000000-0000-7000-8000-0000000000d2');
    const { sessionRepository, run, denied } = setup();
    seedSessions(sessionRepository, userId);
    seedSessions(sessionRepository, other);

    await run(userId);

    const otherIds = await sessionRepository.findSessionIdsByUserId(other);
    expect(denied.map((entry) => entry.id)).not.toEqual(
      expect.arrayContaining(otherIds as SessionId[]),
    );
  });

  it('is a no-op, not an error, for an account with no sessions', async () => {
    const { run, denied } = setup();

    await expect(run(userId)).resolves.toBeUndefined();
    expect(denied).toEqual([]);
  });
});
