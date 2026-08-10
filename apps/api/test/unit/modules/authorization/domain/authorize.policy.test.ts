import { describe, expect, it } from 'vitest';
import type { RoleName } from '../../../../../src/modules/identity/index.js';
import {
  authorize,
  type AccessLevel,
  type Permission,
} from '../../../../../src/modules/authorization/index.js';

/**
 * Column order matches SDD 8.2's table exactly: CUST, V_OWNER, V_MGR,
 * V_STAFF, SUPPORT, CAT_MOD, FINANCE, RISK, SUPER.
 */
const ROLE_COLUMNS: readonly RoleName[] = [
  'CUSTOMER',
  'VENDOR_OWNER',
  'VENDOR_MANAGER',
  'VENDOR_STAFF',
  'SUPPORT_AGENT',
  'CATALOGUE_MODERATOR',
  'FINANCE_ADMIN',
  'RISK_ANALYST',
  'SUPER_ADMIN',
];

/**
 * An independent transcription of SDD 8.2, row-for-row, so it can be
 * eyeballed against the SDD document (one row here = one row there).
 * Deliberately re-typed here rather than imported from the source matrix —
 * comparing this file's transcription against `permission-matrix.ts`'s is
 * what actually verifies the source, not testing the source against itself.
 */
const SDD_8_2_MATRIX: readonly {
  readonly permission: Permission;
  readonly label: string;
  readonly row: readonly AccessLevel[];
}[] = [
  {
    permission: 'BROWSE_CATALOGUE',
    label: 'Browse catalogue',
    row: ['FULL', 'FULL', 'FULL', 'FULL', 'FULL', 'FULL', 'FULL', 'FULL', 'FULL'],
  },
  {
    permission: 'PLACE_ORDER',
    label: 'Place order',
    row: ['FULL', 'NONE', 'NONE', 'NONE', 'NONE', 'NONE', 'NONE', 'NONE', 'NONE'],
  },
  {
    permission: 'VIEW_OWN_ORDERS',
    label: 'View own orders',
    row: ['OWN', 'NONE', 'NONE', 'NONE', 'READ_ONLY', 'NONE', 'READ_ONLY', 'READ_ONLY', 'FULL'],
  },
  {
    permission: 'CANCEL_OWN_ORDER',
    label: 'Cancel own order',
    row: ['OWN', 'NONE', 'NONE', 'NONE', 'FULL', 'NONE', 'NONE', 'NONE', 'FULL'],
  },
  {
    permission: 'WRITE_REVIEW',
    label: 'Write review',
    row: ['OWN', 'NONE', 'NONE', 'NONE', 'NONE', 'NONE', 'NONE', 'NONE', 'NONE'],
  },
  {
    permission: 'REPORT_ABUSE_OR_FRAUD',
    label: 'Report abuse/fraud',
    row: ['FULL', 'FULL', 'FULL', 'FULL', 'FULL', 'FULL', 'FULL', 'FULL', 'FULL'],
  },
  {
    permission: 'MANAGE_SHOP_PROFILE',
    label: 'Manage shop profile',
    row: ['NONE', 'OWN', 'OWN', 'NONE', 'NONE', 'NONE', 'NONE', 'NONE', 'FULL'],
  },
  {
    permission: 'SUBMIT_OR_EDIT_KYC',
    label: 'Submit/edit KYC',
    row: ['NONE', 'OWN', 'NONE', 'NONE', 'NONE', 'NONE', 'NONE', 'NONE', 'READ_ONLY'],
  },
  {
    permission: 'CREATE_OR_EDIT_PRODUCT',
    label: 'Create/edit product',
    row: ['NONE', 'OWN', 'OWN', 'OWN', 'NONE', 'NONE', 'NONE', 'NONE', 'FULL'],
  },
  {
    permission: 'PUBLISH_OR_UNPUBLISH_PRODUCT',
    label: 'Publish/unpublish product',
    row: ['NONE', 'OWN', 'OWN', 'NONE', 'NONE', 'FULL', 'NONE', 'NONE', 'FULL'],
  },
  {
    permission: 'MANAGE_INVENTORY',
    label: 'Manage inventory',
    row: ['NONE', 'OWN', 'OWN', 'OWN', 'NONE', 'NONE', 'NONE', 'NONE', 'READ_ONLY'],
  },
  {
    permission: 'CREATE_PREORDER_CAMPAIGN',
    label: 'Create preorder campaign',
    row: ['NONE', 'OWN', 'OWN', 'NONE', 'NONE', 'NONE', 'NONE', 'NONE', 'READ_ONLY'],
  },
  {
    permission: 'VIEW_VENDOR_ORDERS',
    label: 'View vendor orders',
    row: ['NONE', 'OWN', 'OWN', 'OWN', 'READ_ONLY', 'NONE', 'READ_ONLY', 'READ_ONLY', 'FULL'],
  },
  {
    permission: 'ACCEPT_OR_REJECT_ORDER',
    label: 'Accept/reject order',
    row: ['NONE', 'OWN', 'OWN', 'OWN', 'NONE', 'NONE', 'NONE', 'NONE', 'FULL'],
  },
  {
    permission: 'SCAN_PICKUP_QR',
    label: 'Scan pickup QR',
    row: ['NONE', 'OWN', 'OWN', 'OWN', 'NONE', 'NONE', 'NONE', 'NONE', 'NONE'],
  },
  {
    permission: 'CONFIGURE_DELIVERY_SLOTS',
    label: 'Configure delivery/slots',
    row: ['NONE', 'OWN', 'OWN', 'NONE', 'NONE', 'NONE', 'NONE', 'NONE', 'READ_ONLY'],
  },
  {
    permission: 'VIEW_VENDOR_PAYOUTS',
    label: 'View vendor payouts',
    row: ['NONE', 'OWN', 'READ_ONLY', 'NONE', 'NONE', 'NONE', 'FULL', 'READ_ONLY', 'FULL'],
  },
  {
    permission: 'CHANGE_PAYOUT_BANK_DETAILS',
    label: 'Change payout bank details',
    row: ['NONE', 'OWN', 'NONE', 'NONE', 'NONE', 'NONE', 'NONE', 'NONE', 'READ_ONLY'],
  },
  {
    permission: 'MANAGE_VENDOR_STAFF',
    label: 'Manage vendor staff',
    row: ['NONE', 'OWN', 'NONE', 'NONE', 'NONE', 'NONE', 'NONE', 'NONE', 'FULL'],
  },
  {
    permission: 'APPROVE_OR_REJECT_PRODUCT',
    label: 'Approve/reject product',
    row: ['NONE', 'NONE', 'NONE', 'NONE', 'NONE', 'FULL', 'NONE', 'NONE', 'FULL'],
  },
  {
    permission: 'APPROVE_OR_REJECT_VENDOR_KYC',
    label: 'Approve/reject vendor KYC',
    row: ['NONE', 'NONE', 'NONE', 'NONE', 'NONE', 'READ_ONLY', 'READ_ONLY', 'FULL', 'FULL'],
  },
  {
    permission: 'SUSPEND_VENDOR_OR_USER',
    label: 'Suspend vendor/user',
    row: ['NONE', 'NONE', 'NONE', 'NONE', 'NONE', 'NONE', 'NONE', 'FULL', 'FULL'],
  },
  {
    permission: 'PLACE_OR_RELEASE_FUND_HOLD',
    label: 'Place/release fund hold',
    row: ['NONE', 'NONE', 'NONE', 'NONE', 'NONE', 'NONE', 'FULL', 'FULL', 'FULL'],
  },
  {
    permission: 'ISSUE_REFUND_UP_TO_5000',
    label: 'Issue refund (≤ ₹5,000)',
    row: ['NONE', 'NONE', 'NONE', 'NONE', 'FULL', 'NONE', 'FULL', 'NONE', 'FULL'],
  },
  {
    permission: 'ISSUE_REFUND_OVER_5000',
    label: 'Issue refund (> ₹5,000)',
    row: ['NONE', 'NONE', 'NONE', 'NONE', 'NONE', 'NONE', 'FULL', 'NONE', 'FULL'],
  },
  {
    permission: 'TRIGGER_SETTLEMENT_RUN',
    label: 'Trigger settlement run',
    row: ['NONE', 'NONE', 'NONE', 'NONE', 'NONE', 'NONE', 'FULL', 'NONE', 'FULL'],
  },
  {
    permission: 'VIEW_OR_CLOSE_FRAUD_CASES',
    label: 'View/close fraud cases',
    row: ['NONE', 'NONE', 'NONE', 'NONE', 'READ_ONLY', 'NONE', 'READ_ONLY', 'FULL', 'FULL'],
  },
  {
    permission: 'CONFIGURE_FRAUD_RULES',
    label: 'Configure fraud rules',
    row: ['NONE', 'NONE', 'NONE', 'NONE', 'NONE', 'NONE', 'NONE', 'FULL', 'FULL'],
  },
  {
    permission: 'MODERATE_REVIEWS',
    label: 'Moderate reviews',
    row: ['NONE', 'NONE', 'NONE', 'NONE', 'READ_ONLY', 'FULL', 'NONE', 'READ_ONLY', 'FULL'],
  },
  {
    permission: 'MANAGE_CATEGORIES_OR_COMMISSION',
    label: 'Manage categories/commission',
    row: ['NONE', 'NONE', 'NONE', 'NONE', 'NONE', 'READ_ONLY', 'FULL', 'NONE', 'FULL'],
  },
  {
    permission: 'VIEW_PLATFORM_ANALYTICS',
    label: 'View platform analytics',
    row: ['NONE', 'NONE', 'NONE', 'NONE', 'READ_ONLY', 'READ_ONLY', 'FULL', 'READ_ONLY', 'FULL'],
  },
  {
    permission: 'MANAGE_ADMIN_USERS_OR_ROLES',
    label: 'Manage admin users/roles',
    row: ['NONE', 'NONE', 'NONE', 'NONE', 'NONE', 'NONE', 'NONE', 'NONE', 'FULL'],
  },
  {
    permission: 'VIEW_AUDIT_LOG',
    label: 'View audit log',
    row: ['NONE', 'NONE', 'NONE', 'NONE', 'NONE', 'NONE', 'READ_ONLY', 'READ_ONLY', 'FULL'],
  },
  {
    permission: 'IMPERSONATE_USER',
    label: 'Impersonate user (audited)',
    row: ['NONE', 'NONE', 'NONE', 'NONE', 'FULL', 'NONE', 'NONE', 'NONE', 'FULL'],
  },
  {
    permission: 'EXPORT_PII_DPDP_REQUESTS',
    label: 'Export PII / DPDP requests',
    row: ['NONE', 'NONE', 'NONE', 'NONE', 'NONE', 'NONE', 'NONE', 'NONE', 'FULL'],
  },
];

describe('authorize() — SDD 8.2 permission matrix, full coverage', () => {
  it('transcribes exactly the 35 SDD 8.2 rows', () => {
    expect(SDD_8_2_MATRIX).toHaveLength(35);
    for (const { row } of SDD_8_2_MATRIX) {
      expect(row).toHaveLength(9);
    }
  });

  for (const { permission, label, row } of SDD_8_2_MATRIX) {
    describe(`${label} (${permission})`, () => {
      ROLE_COLUMNS.forEach((role, index) => {
        const expected = row[index];

        if (expected === 'NONE') {
          it(`denies ${role}`, () => {
            expect(authorize(role, permission)).toEqual({ outcome: 'DENY' });
          });
        } else {
          it(`grants ${role} ${expected}`, () => {
            const decision = authorize(role, permission);
            expect(decision.outcome).toBe('ALLOW');
            expect(decision.accessLevel).toBe(expected);
          });
        }
      });
    });
  }
});

describe('authorize() — symbol semantics', () => {
  it('● FULL grants are not scoped and carry no step-up requirement', () => {
    const decision = authorize('SUPER_ADMIN', 'BROWSE_CATALOGUE');
    expect(decision).toEqual({ outcome: 'ALLOW', accessLevel: 'FULL' });
  });

  it('◐ OWN grants report the scope without resolving resource ownership', () => {
    const decision = authorize('VENDOR_OWNER', 'MANAGE_SHOP_PROFILE');
    expect(decision).toEqual({ outcome: 'ALLOW', accessLevel: 'OWN' });
  });

  it('○ READ_ONLY grants are distinct from ◐ OWN and ● FULL', () => {
    const decision = authorize('RISK_ANALYST', 'VIEW_VENDOR_PAYOUTS');
    expect(decision).toEqual({ outcome: 'ALLOW', accessLevel: 'READ_ONLY' });
  });

  it('— NONE denies without an accessLevel', () => {
    const decision = authorize('CUSTOMER', 'APPROVE_OR_REJECT_PRODUCT');
    expect(decision).toEqual({ outcome: 'DENY' });
    expect(decision.accessLevel).toBeUndefined();
  });

  it("flags SDD 8.2's one annotated cell — V_OWNER's payout-bank-details grant requires step-up", () => {
    const decision = authorize('VENDOR_OWNER', 'CHANGE_PAYOUT_BANK_DETAILS');
    expect(decision).toEqual({ outcome: 'ALLOW', accessLevel: 'OWN', requiresStepUp: true });
  });

  it('does not attach the step-up flag to any other role or permission', () => {
    for (const { permission, row } of SDD_8_2_MATRIX) {
      ROLE_COLUMNS.forEach((role, index) => {
        if (permission === 'CHANGE_PAYOUT_BANK_DETAILS' && role === 'VENDOR_OWNER') return;
        if (row[index] === 'NONE') return;
        expect(authorize(role, permission).requiresStepUp).toBeUndefined();
      });
    }
  });
});

describe('authorize() — deny-by-default and unknown input', () => {
  it('denies an unrecognised permission rather than falling through to allow', () => {
    const decision = authorize('SUPER_ADMIN', 'NOT_A_REAL_PERMISSION' as Permission);
    expect(decision).toEqual({ outcome: 'DENY' });
  });

  it('denies an unrecognised role rather than falling through to allow', () => {
    const decision = authorize('NOT_A_REAL_ROLE' as RoleName, 'BROWSE_CATALOGUE');
    expect(decision).toEqual({ outcome: 'DENY' });
  });

  it('denies the old, now-removed flat VENDOR/ADMIN role names', () => {
    expect(authorize('VENDOR' as RoleName, 'CREATE_OR_EDIT_PRODUCT')).toEqual({ outcome: 'DENY' });
    expect(authorize('ADMIN' as RoleName, 'MANAGE_ADMIN_USERS_OR_ROLES')).toEqual({
      outcome: 'DENY',
    });
  });
});

describe('authorize() — no accidental cross-role inheritance', () => {
  it('CUSTOMER receives NONE for every admin-only and vendor-only permission', () => {
    const customerOnly = new Set<Permission>([
      'PLACE_ORDER',
      'VIEW_OWN_ORDERS',
      'CANCEL_OWN_ORDER',
      'WRITE_REVIEW',
    ]);
    const universal = new Set<Permission>(['BROWSE_CATALOGUE', 'REPORT_ABUSE_OR_FRAUD']);
    for (const { permission } of SDD_8_2_MATRIX) {
      if (customerOnly.has(permission) || universal.has(permission)) continue;
      expect(authorize('CUSTOMER', permission)).toEqual({ outcome: 'DENY' });
    }
  });

  it('VENDOR_STAFF never receives permissions reserved for VENDOR_OWNER (e.g. shop profile, staff management, KYC)', () => {
    for (const permission of [
      'MANAGE_SHOP_PROFILE',
      'SUBMIT_OR_EDIT_KYC',
      'MANAGE_VENDOR_STAFF',
      'CHANGE_PAYOUT_BANK_DETAILS',
    ] as const satisfies readonly Permission[]) {
      expect(authorize('VENDOR_STAFF', permission)).toEqual({ outcome: 'DENY' });
    }
  });

  it('CATALOGUE_MODERATOR does not receive FINANCE_ADMIN-only permissions (fund hold, settlement, refunds)', () => {
    for (const permission of [
      'PLACE_OR_RELEASE_FUND_HOLD',
      'ISSUE_REFUND_OVER_5000',
      'TRIGGER_SETTLEMENT_RUN',
    ] as const satisfies readonly Permission[]) {
      expect(authorize('CATALOGUE_MODERATOR', permission)).toEqual({ outcome: 'DENY' });
    }
  });

  it('SUPPORT_AGENT does not receive RISK_ANALYST-only permissions (suspend, fraud-rule configuration)', () => {
    for (const permission of [
      'SUSPEND_VENDOR_OR_USER',
      'CONFIGURE_FRAUD_RULES',
    ] as const satisfies readonly Permission[]) {
      expect(authorize('SUPPORT_AGENT', permission)).toEqual({ outcome: 'DENY' });
    }
  });

  it('FINANCE_ADMIN does not receive CATALOGUE_MODERATOR-only product-approval permission', () => {
    expect(authorize('FINANCE_ADMIN', 'APPROVE_OR_REJECT_PRODUCT')).toEqual({ outcome: 'DENY' });
  });

  it('separation of duties holds: only SUPER_ADMIN can both approve products and manage admin users/roles', () => {
    for (const role of ROLE_COLUMNS) {
      if (role === 'SUPER_ADMIN') continue;
      const approvesProducts = authorize(role, 'APPROVE_OR_REJECT_PRODUCT').outcome === 'ALLOW';
      const managesAdmins = authorize(role, 'MANAGE_ADMIN_USERS_OR_ROLES').outcome === 'ALLOW';
      expect(approvesProducts && managesAdmins).toBe(false);
    }
  });
});
