import type { Session } from '../entities/session.entity.js';

/** Uses `string` for the hash lookup, matching `Session.tokenHash` — never look up a session by anything but its hash. */
export interface SessionRepository {
  create(session: Session): Promise<void>;
  update(session: Session): Promise<void>;
  findByTokenHash(tokenHash: string): Promise<Session | null>;
}
