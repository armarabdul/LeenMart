import type { SessionId } from '../value-objects/session-id.value-object.js';
import type { UserId } from '../value-objects/user-id.value-object.js';

export interface SessionProps {
  readonly id: SessionId;
  readonly userId: UserId;
  /**
   * The rotation lineage this session belongs to (SDD 7.2's "session
   * family"). A fresh login roots a new family at its own id; every rotation
   * carries the same value forward, so one family is exactly one login and
   * its descendants.
   *
   * Deliberately narrower than "every session this user has": SDD 7.2
   * assigns user-wide revocation to different triggers — suspension, a
   * password change, "log out all devices" — so a theft detected on one
   * device must not sign the user out on another.
   */
  readonly familyId: SessionId;
  readonly tokenHash: string;
  readonly expiresAt: Date;
  readonly revokedAt: Date | null;
  readonly replacedByTokenId: SessionId | null;
  readonly createdAt: Date;
}

/**
 * A login session, identified only by the hash of its opaque refresh token
 * (SDD 6.1). Formerly named `RefreshToken` — same entity, same invariants;
 * "session" is the domain concept, "refresh token" was the implementation
 * detail it was originally named after. See refresh-token.entity.ts for the
 * backward-compatible alias existing callers still use.
 *
 * Rotation is modelled explicitly: `revoke()` records both that a token died
 * and, when it died because it was exchanged for a new one, which token
 * replaced it. That distinction is what lets a reused, already-rotated token
 * be recognised as token theft rather than an ordinary expiry — see
 * `wasRotatedAway()`, which is the signal SDD 7.2's reuse detection acts on.
 */
export class Session {
  private constructor(private readonly props: SessionProps) {}

  static issue(props: {
    id: SessionId;
    userId: UserId;
    tokenHash: string;
    expiresAt: Date;
    now: Date;
    /**
     * The family to continue. Omitted for a fresh login, which roots its own
     * family at this session's id — so every session always belongs to
     * exactly one family and the column is never nullable.
     */
    familyId?: SessionId;
  }): Session {
    return new Session({
      id: props.id,
      userId: props.userId,
      familyId: props.familyId ?? props.id,
      tokenHash: props.tokenHash,
      expiresAt: props.expiresAt,
      revokedAt: null,
      replacedByTokenId: null,
      createdAt: props.now,
    });
  }

  static reconstitute(props: SessionProps): Session {
    return new Session(props);
  }

  get id(): SessionId {
    return this.props.id;
  }

  get userId(): UserId {
    return this.props.userId;
  }

  get familyId(): SessionId {
    return this.props.familyId;
  }

  get tokenHash(): string {
    return this.props.tokenHash;
  }

  get expiresAt(): Date {
    return this.props.expiresAt;
  }

  get revokedAt(): Date | null {
    return this.props.revokedAt;
  }

  get replacedByTokenId(): SessionId | null {
    return this.props.replacedByTokenId;
  }

  isExpired(now: Date): boolean {
    return this.props.expiresAt.getTime() <= now.getTime();
  }

  isRevoked(): boolean {
    return this.props.revokedAt !== null;
  }

  isActive(now: Date): boolean {
    return !this.isExpired(now) && !this.isRevoked();
  }

  /**
   * True only for a session that died *because it was exchanged for a new
   * one*. Presenting such a token is what SDD 7.2 calls "definitionally a
   * stolen token": the legitimate holder already has the replacement, so
   * whoever is presenting the old one should not have it.
   *
   * Deliberately narrower than `isRevoked()`. Logout revokes without a
   * replacement (`replacedByTokenId` stays null), and a client that retries
   * with a logged-out token is stale, not hostile — treating that as theft
   * would revoke a family on an ordinary double-tap of a logout button.
   */
  wasRotatedAway(): boolean {
    return this.isRevoked() && this.props.replacedByTokenId !== null;
  }

  revoke(now: Date, replacedByTokenId: SessionId | null = null): Session {
    return new Session({ ...this.props, revokedAt: now, replacedByTokenId });
  }
}
