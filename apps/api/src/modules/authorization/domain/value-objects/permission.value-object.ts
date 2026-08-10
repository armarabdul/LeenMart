/**
 * The platform's permissions — one identifier per SDD 8.2 permission-matrix
 * row, named to mirror the SDD's own row label as closely as a TypeScript
 * identifier allows. `PERMISSION_LABELS` carries the literal SDD wording for
 * each identifier, so `permission-matrix.ts` can be reviewed cell-by-cell
 * against the SDD table.
 */
export type Permission =
  | 'BROWSE_CATALOGUE'
  | 'PLACE_ORDER'
  | 'VIEW_OWN_ORDERS'
  | 'CANCEL_OWN_ORDER'
  | 'WRITE_REVIEW'
  | 'REPORT_ABUSE_OR_FRAUD'
  | 'MANAGE_SHOP_PROFILE'
  | 'SUBMIT_OR_EDIT_KYC'
  | 'CREATE_OR_EDIT_PRODUCT'
  | 'PUBLISH_OR_UNPUBLISH_PRODUCT'
  | 'MANAGE_INVENTORY'
  | 'CREATE_PREORDER_CAMPAIGN'
  | 'VIEW_VENDOR_ORDERS'
  | 'ACCEPT_OR_REJECT_ORDER'
  | 'SCAN_PICKUP_QR'
  | 'CONFIGURE_DELIVERY_SLOTS'
  | 'VIEW_VENDOR_PAYOUTS'
  | 'CHANGE_PAYOUT_BANK_DETAILS'
  | 'MANAGE_VENDOR_STAFF'
  | 'APPROVE_OR_REJECT_PRODUCT'
  | 'APPROVE_OR_REJECT_VENDOR_KYC'
  | 'SUSPEND_VENDOR_OR_USER'
  | 'PLACE_OR_RELEASE_FUND_HOLD'
  | 'ISSUE_REFUND_UP_TO_5000'
  | 'ISSUE_REFUND_OVER_5000'
  | 'TRIGGER_SETTLEMENT_RUN'
  | 'VIEW_OR_CLOSE_FRAUD_CASES'
  | 'CONFIGURE_FRAUD_RULES'
  | 'MODERATE_REVIEWS'
  | 'MANAGE_CATEGORIES_OR_COMMISSION'
  | 'VIEW_PLATFORM_ANALYTICS'
  | 'MANAGE_ADMIN_USERS_OR_ROLES'
  | 'VIEW_AUDIT_LOG'
  | 'IMPERSONATE_USER'
  | 'EXPORT_PII_DPDP_REQUESTS';

/** The exact SDD 8.2 row label each `Permission` identifier stands for. */
export const PERMISSION_LABELS: Readonly<Record<Permission, string>> = {
  BROWSE_CATALOGUE: 'Browse catalogue',
  PLACE_ORDER: 'Place order',
  VIEW_OWN_ORDERS: 'View own orders',
  CANCEL_OWN_ORDER: 'Cancel own order',
  WRITE_REVIEW: 'Write review',
  REPORT_ABUSE_OR_FRAUD: 'Report abuse/fraud',
  MANAGE_SHOP_PROFILE: 'Manage shop profile',
  SUBMIT_OR_EDIT_KYC: 'Submit/edit KYC',
  CREATE_OR_EDIT_PRODUCT: 'Create/edit product',
  PUBLISH_OR_UNPUBLISH_PRODUCT: 'Publish/unpublish product',
  MANAGE_INVENTORY: 'Manage inventory',
  CREATE_PREORDER_CAMPAIGN: 'Create preorder campaign',
  VIEW_VENDOR_ORDERS: 'View vendor orders',
  ACCEPT_OR_REJECT_ORDER: 'Accept/reject order',
  SCAN_PICKUP_QR: 'Scan pickup QR',
  CONFIGURE_DELIVERY_SLOTS: 'Configure delivery/slots',
  VIEW_VENDOR_PAYOUTS: 'View vendor payouts',
  CHANGE_PAYOUT_BANK_DETAILS: 'Change payout bank details',
  MANAGE_VENDOR_STAFF: 'Manage vendor staff',
  APPROVE_OR_REJECT_PRODUCT: 'Approve/reject product',
  APPROVE_OR_REJECT_VENDOR_KYC: 'Approve/reject vendor KYC',
  SUSPEND_VENDOR_OR_USER: 'Suspend vendor/user',
  PLACE_OR_RELEASE_FUND_HOLD: 'Place/release fund hold',
  ISSUE_REFUND_UP_TO_5000: 'Issue refund (≤ ₹5,000)',
  ISSUE_REFUND_OVER_5000: 'Issue refund (> ₹5,000)',
  TRIGGER_SETTLEMENT_RUN: 'Trigger settlement run',
  VIEW_OR_CLOSE_FRAUD_CASES: 'View/close fraud cases',
  CONFIGURE_FRAUD_RULES: 'Configure fraud rules',
  MODERATE_REVIEWS: 'Moderate reviews',
  MANAGE_CATEGORIES_OR_COMMISSION: 'Manage categories/commission',
  VIEW_PLATFORM_ANALYTICS: 'View platform analytics',
  MANAGE_ADMIN_USERS_OR_ROLES: 'Manage admin users/roles',
  VIEW_AUDIT_LOG: 'View audit log',
  IMPERSONATE_USER: 'Impersonate user (audited)',
  EXPORT_PII_DPDP_REQUESTS: 'Export PII / DPDP requests',
};
