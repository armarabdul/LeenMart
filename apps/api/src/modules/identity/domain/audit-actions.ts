/**
 * The audit vocabulary for this bounded context (SDD 18.4's `action` and
 * `entityType`).
 *
 * SDD 18.4 names both columns but defines no values for either, so the naming
 * convention is a project decision rather than a transcription. It follows the
 * dotted, bounded-context-scoped form this module's domain events already use
 * (`identity.vendor.approved` and friends) rather than introducing a third
 * style: the two vocabularies describe the same actions from different angles,
 * and one prefix per module keeps them collision-free across the sixteen
 * modules SDD 5 lists.
 *
 * The names live here, in the context that owns the actions, for the same
 * reason the event type strings do. The `audit` module stores whatever it is
 * given and interprets none of it — a shared registry there would make every
 * module's vocabulary everyone else's compile-time dependency.
 *
 * Only the two actions this chunk actually writes are listed. Entries are
 * added by the chunk that emits them; an unused constant is a guess about a
 * feature that does not exist yet.
 */
export const IDENTITY_AUDIT_ACTIONS = {
  /** A completed administrator sign-in: password *and* TOTP verified, session issued. */
  ADMIN_LOGIN: 'identity.admin.login',
  /** An administrator's session deliberately ended. */
  ADMIN_LOGOUT: 'identity.admin.logout',
  /** A SUPER_ADMIN created a subordinate administrator account (Phase L.2, SDD 8.1/8.2). */
  ADMIN_USER_CREATED: 'identity.admin.user_created',
} as const;

export type IdentityAuditAction =
  (typeof IDENTITY_AUDIT_ACTIONS)[keyof typeof IDENTITY_AUDIT_ACTIONS];

/**
 * Stable domain entity names, not table names: `audit_logs` is a domain
 * artefact retained for eight years, and an entry written today must still
 * name the same thing after a table rename.
 */
export const IDENTITY_AUDIT_ENTITY_TYPES = {
  USER: 'User',
} as const;

export type IdentityAuditEntityType =
  (typeof IDENTITY_AUDIT_ENTITY_TYPES)[keyof typeof IDENTITY_AUDIT_ENTITY_TYPES];
