import type { SessionId } from '../value-objects/session-id.value-object.js';
import type { Session } from '../entities/session.entity.js';

/** Uses `string` for the hash lookup, matching `Session.tokenHash` — never look up a session by anything but its hash. */
export interface SessionRepository {
  create(session: Session): Promise<void>;
  update(session: Session): Promise<void>;
  findByTokenHash(tokenHash: string): Promise<Session | null>;

  /**
   * Revokes every still-live session in one rotation lineage, in a single
   * statement, and reports how many died (SDD 7.2: on reuse detection "the
   * entire session family is revoked").
   *
   * One indexed `UPDATE` rather than walking `replacedByTokenId` link by
   * link. A 30-day sliding family refreshed on a 15-minute access token can
   * run to thousands of links, and this path is reached only by *presenting
   * a stolen token* — so a per-request walk would hand an attacker a way to
   * force thousands of queries at will. The family id makes the blast radius
   * one query regardless of chain length.
   *
   * Already-revoked rows are left alone, so the count is the number of
   * sessions this call actually killed — what the caller logs as the blast
   * radius, not a restatement of the family's size.
   */
  revokeFamily(familyId: SessionId, now: Date): Promise<number>;
}
