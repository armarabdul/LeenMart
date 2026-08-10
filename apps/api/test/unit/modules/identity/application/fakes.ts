import { NullLogger } from '@leen-mart/domain-kit';
import type { SessionId } from '../../../../../src/modules/identity/domain/value-objects/session-id.value-object.js';
import type { UserId } from '../../../../../src/modules/identity/domain/value-objects/user-id.value-object.js';
import type { OtpId } from '../../../../../src/modules/identity/domain/value-objects/otp-id.value-object.js';
import type { PhoneNumber } from '../../../../../src/modules/identity/domain/value-objects/phone-number.value-object.js';
import type { RoleName } from '../../../../../src/modules/identity/domain/value-objects/role.value-object.js';
import type {
  AccessTokenClaims,
  AccessTokenService,
  SignedAccessToken,
} from '../../../../../src/modules/identity/application/ports/access-token.port.js';
import type { PasswordHasher } from '../../../../../src/modules/identity/application/ports/password-hasher.port.js';
import type { RefreshTokenHasher } from '../../../../../src/modules/identity/application/ports/refresh-token-hasher.port.js';
import type { RefreshTokenRepository } from '../../../../../src/modules/identity/application/ports/refresh-token-repository.port.js';
import type { UserRepository } from '../../../../../src/modules/identity/application/ports/user-repository.port.js';
import type { OtpGenerator } from '../../../../../src/modules/identity/domain/services/otp-generator.service.js';
import type { OtpHasher } from '../../../../../src/modules/identity/domain/services/otp-hasher.service.js';
import type { OtpRepository } from '../../../../../src/modules/identity/domain/repositories/otp.repository.js';
import type { RefreshToken } from '../../../../../src/modules/identity/domain/entities/refresh-token.entity.js';
import type { User } from '../../../../../src/modules/identity/domain/entities/user.entity.js';
import type { Otp } from '../../../../../src/modules/identity/domain/entities/otp.entity.js';
import { PasswordHash } from '../../../../../src/modules/identity/domain/value-objects/password-hash.value-object.js';
import { OtpCode } from '../../../../../src/modules/identity/domain/value-objects/otp-code.value-object.js';

export class InMemoryUserRepository implements UserRepository {
  private readonly byId = new Map<UserId, User>();

  create(user: User): Promise<void> {
    this.byId.set(user.id, user);
    return Promise.resolve();
  }

  update(user: User): Promise<void> {
    this.byId.set(user.id, user);
    return Promise.resolve();
  }

  findByEmail(email: string): Promise<User | null> {
    for (const user of this.byId.values()) {
      if (user.email === email) return Promise.resolve(user);
    }
    return Promise.resolve(null);
  }

  findByPhone(phone: PhoneNumber): Promise<User | null> {
    for (const user of this.byId.values()) {
      if (user.phone?.equals(phone)) return Promise.resolve(user);
    }
    return Promise.resolve(null);
  }

  findById(id: UserId): Promise<User | null> {
    return Promise.resolve(this.byId.get(id) ?? null);
  }

  existsWithAnyRole(roles: readonly RoleName[]): Promise<boolean> {
    for (const user of this.byId.values()) {
      if (roles.includes(user.role.name)) return Promise.resolve(true);
    }
    return Promise.resolve(false);
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
  hash(plaintext: string): Promise<PasswordHash> {
    return Promise.resolve(PasswordHash.create(`hashed:${plaintext}`));
  }

  verify(hash: PasswordHash, plaintext: string): Promise<boolean> {
    return Promise.resolve(hash.value === `hashed:${plaintext}`);
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

export class InMemoryOtpRepository implements OtpRepository {
  private readonly byId = new Map<OtpId, Otp>();

  create(otp: Otp): Promise<void> {
    this.byId.set(otp.id, otp);
    return Promise.resolve();
  }

  update(otp: Otp): Promise<void> {
    this.byId.set(otp.id, otp);
    return Promise.resolve();
  }

  findById(id: OtpId): Promise<Otp | null> {
    return Promise.resolve(this.byId.get(id) ?? null);
  }

  findActiveByUserId(userId: UserId): Promise<Otp | null> {
    // Map iteration is insertion order, so the last match is the most
    // recent — same "most recent unconsumed" semantics as the Prisma
    // implementation's `ORDER BY created_at DESC` without needing a
    // createdAt getter on the entity (it doesn't expose one, same as Session).
    let mostRecent: Otp | null = null;
    for (const otp of this.byId.values()) {
      if (otp.userId === userId && !otp.isConsumed()) {
        mostRecent = otp;
      }
    }
    return Promise.resolve(mostRecent);
  }
}

/** Hands out predictable codes so tests can assert exactly what gets hashed. */
export class FakeOtpGenerator implements OtpGenerator {
  private index = 0;

  constructor(private readonly codes: readonly string[] = ['123456']) {}

  generate(): OtpCode {
    const code = this.codes[this.index % this.codes.length];
    this.index += 1;
    return OtpCode.create(code ?? '123456');
  }
}

/** Deliberately not a real hash — fast and inspectable for assertions. */
export class FakeOtpHasher implements OtpHasher {
  hash(rawCode: string): Promise<string> {
    return Promise.resolve(`hashed:${rawCode}`);
  }

  verify(hash: string, rawCode: string): Promise<boolean> {
    return Promise.resolve(hash === `hashed:${rawCode}`);
  }
}

export const nullLogger = new NullLogger();
