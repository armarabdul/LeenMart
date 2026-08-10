import type { RoleName } from '../../../identity/index.js';
import type { AccessLevel } from '../value-objects/access-level.value-object.js';
import type { Permission } from '../value-objects/permission.value-object.js';
import { PERMISSION_MATRIX } from './permission-matrix.js';

export type AuthorizationOutcome = 'ALLOW' | 'DENY';

export interface AuthorizationDecision {
  readonly outcome: AuthorizationOutcome;
  /** ● / ◐ / ○ (SDD 8.2) — present only when `outcome` is `'ALLOW'`. */
  readonly accessLevel?: Exclude<AccessLevel, 'NONE'>;
  /**
   * SDD 8.2's one annotated cell: V_OWNER's `CHANGE_PAYOUT_BANK_DETAILS`
   * grant is marked "◐ (MFA + step-up)". This only *reports* that the grant
   * carries the requirement — enforcing step-up re-authentication is a
   * later authentication-layer concern (SDD 7.5), not this policy's job.
   */
  readonly requiresStepUp?: true;
}

const ALLOW_WITH_STEP_UP: ReadonlySet<`${Permission}:${RoleName}`> = new Set([
  'CHANGE_PAYOUT_BANK_DETAILS:VENDOR_OWNER',
]);

/**
 * SDD 7.4's policy evaluation: "a pure function (principal, action,
 * resource) → Allow | Deny with an explicit deny-by-default."
 *
 * This implements exactly step 2 of §7.4 ("may this role perform this
 * action at all?") — the declarative, interface-layer permission check
 * against SDD 8.2's static matrix. Step 3 ("may *this* principal act on
 * *this specific* object?") is explicitly a later, application-layer
 * concern once a use case has loaded the resource instance — so this
 * function takes a role and a permission, not a concrete resource. A
 * `◐ OWN` decision tells the caller the grant exists but is scoped; it does
 * not and cannot resolve ownership itself without the loaded object.
 *
 * Deterministic, side-effect-free, no HTTP/JWT/request concepts. An
 * unrecognised role or permission (only reachable by bypassing the closed
 * `RoleName`/`Permission` types, e.g. from an unvalidated external value)
 * denies safely rather than falling through to an implicit allow.
 */
export const authorize = (role: RoleName, permission: Permission): AuthorizationDecision => {
  const accessLevel: AccessLevel | undefined = PERMISSION_MATRIX[permission]?.[role];

  if (!accessLevel || accessLevel === 'NONE') {
    return { outcome: 'DENY' };
  }

  const requiresStepUp = ALLOW_WITH_STEP_UP.has(`${permission}:${role}`);
  return {
    outcome: 'ALLOW',
    accessLevel,
    ...(requiresStepUp ? { requiresStepUp: true as const } : {}),
  };
};
