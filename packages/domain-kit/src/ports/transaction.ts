import type { Brand } from '../primitives/branded.js';

/**
 * An opaque handle to an open database transaction.
 *
 * Deliberately carries no structure. The domain and application layers are
 * forbidden from importing `@prisma/*` (SDD 2.3, enforced by lint), so a
 * repository port cannot name the transaction client's real type — but it can
 * accept a token that only the infrastructure layer knows how to unwrap. That
 * keeps "these two writes happen together" expressible in a use case without
 * the use case learning what a Prisma client is.
 *
 * Branded rather than `unknown` so a caller cannot pass any object at all: the
 * only way to obtain one is from `TransactionRunner.run`.
 */
export type TransactionScope = Brand<object, 'TransactionScope'>;

/**
 * Runs work inside a single database transaction (SDD 2.3's dependency rule:
 * the application layer orchestrates, the adapter owns the mechanism).
 *
 * Exists because some operations span two modules' repositories and must be
 * atomic — vendor registration promotes a `users` row and inserts a `vendors`
 * row, and a crash between them would leave an account that owns a vendor it
 * has no permission to act for. Neither module's repository can own that
 * transaction without reaching into the other's tables, so the boundary lives
 * here instead.
 *
 * Every repository used inside the callback must be re-bound to the supplied
 * scope via its own `withTransaction`. A repository left on the outer client
 * would run on a different connection, outside the transaction, and would not
 * roll back with it.
 */
export interface TransactionRunner {
  run<T>(work: (scope: TransactionScope) => Promise<T>): Promise<T>;
}
