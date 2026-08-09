import { NullLogger } from '@leen-mart/domain-kit';
import type { SessionId } from '../../../../../src/modules/identity/domain/value-objects/session-id.value-object.js';
import type { UserId } from '../../../../../src/modules/identity/domain/value-objects/user-id.value-object.js';
import type {
  AccessTokenClaims,
  AccessTokenService,
  SignedAccessToken,
} from '../../../../../src/modules/identity/application/ports/access-token.port.js';
import type { PasswordHasher } from '../../../../../src/modules/identity/application/ports/password-hasher.port.js';
import type { RefreshTokenHasher } from '../../../../../src/modules/identity/application/ports/refresh-token-hasher.port.js';
import type { RefreshTokenRepository } from '../../../../../src/modules/identity/application/ports/refresh-token-repository.port.js';
import type { UserRepository } from '../../../../../src/modules/identity/application/ports/user-repository.port.js';
import type { RefreshToken } from '../../../../../src/modules/identity/domain/entities/refresh-token.entity.js';
import type { User } from '../../../../../src/modules/identity/domain/entities/user.entity.js';

export class InMemoryUserRepository implements UserRepository {
  private readonly byId = new Map<UserId, User>();

  create(user: User): Promise<void> {
    this.byId.set(user.id, user);
    return Promise.resolve();
  }

  findByEmail(email: string): Promise<User | null> {
    for (const user of this.byId.values()) {
      if (user.email === email) return Promise.resolve(user);
    }
    return Promise.resolve(null);
  }

  findById(id: UserId): Promise<User | null> {
    return Promise.resolve(this.byId.get(id) ?? null);
  }
}

export class InMemoryRefreshTokenRepository implements RefreshTokenRepository {
  private readonly byId = new Map<SessionId, RefreshToken>();

  create(token: RefreshToken): Promise<void> {
    this.byId.set(token.id, token);
    return Promise.resolve();
  }

  update(token: RefreshToken): Promise<void> {
    this.byId.set(token.id, token);
    return Promise.resolve();
  }

  findByTokenHash(tokenHash: string): Promise<RefreshToken | null> {
    for (const token of this.byId.values()) {
      if (token.tokenHash === tokenHash) return Promise.resolve(token);
    }
    return Promise.resolve(null);
  }
}

/** Deliberately not a real hash — fast and inspectable for assertions. */
export class FakePasswordHasher implements PasswordHasher {
  hash(plaintext: string): Promise<string> {
    return Promise.resolve(`hashed:${plaintext}`);
  }

  verify(hash: string, plaintext: string): Promise<boolean> {
    return Promise.resolve(hash === `hashed:${plaintext}`);
  }
}

export class FakeAccessTokenService implements AccessTokenService {
  constructor(private readonly signedToken: SignedAccessToken) {}

  sign(_claims: AccessTokenClaims): SignedAccessToken {
    return this.signedToken;
  }

  verify(): AccessTokenClaims {
    throw new Error('Not implemented: no identity use case verifies an access token today.');
  }
}

/** Hands out predictable, incrementing raw tokens so rotation is easy to assert on. */
export class SequentialRefreshTokenHasher implements RefreshTokenHasher {
  private counter = 0;

  generate(): string {
    this.counter += 1;
    return `raw-token-${this.counter}`;
  }

  hash(rawToken: string): string {
    return `hash:${rawToken}`;
  }
}

export const nullLogger = new NullLogger();
