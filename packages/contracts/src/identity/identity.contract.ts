import { z } from 'zod';
import {
  cursorPaginationSchema,
  emailSchema,
  isoDateTimeSchema,
  phoneSchema,
  uuidSchema,
} from '../common/primitives.js';

/** Mirrors the domain `Role` value object's nine fixed roles (SDD 8.1). */
export const roleSchema = z.enum([
  'CUSTOMER',
  'VENDOR_OWNER',
  'VENDOR_MANAGER',
  'VENDOR_STAFF',
  'SUPER_ADMIN',
  'CATALOGUE_MODERATOR',
  'FINANCE_ADMIN',
  'RISK_ANALYST',
  'SUPPORT_AGENT',
]);

/**
 * SDD 7.5's password policy — "minimum 10 characters" — stated once, where
 * the boundary that enforces it lives. The policy sentence is not scoped to
 * any one role; the admin console's extra controls are a separate sentence,
 * and `ADMIN_PASSWORD_MIN_LENGTH` applies the same floor on the admin
 * bootstrap path, which has no HTTP schema to carry it.
 */
export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 128;

export const registerCustomerRequestSchema = z
  .object({
    email: emailSchema,
    password: z.string().min(PASSWORD_MIN_LENGTH).max(PASSWORD_MAX_LENGTH),
  })
  .strict();

/**
 * Login deliberately does **not** apply the policy minimum. It accepts any
 * non-empty string and lets the credential check fail uniformly: rejecting a
 * short password at the schema tells an attacker their guess was too short to
 * be this account's password, which is a free bit of information about a
 * stored credential (SEC-15). The same reasoning holds for every other
 * password-bearing surface below.
 */
export const loginRequestSchema = z
  .object({
    email: emailSchema,
    password: z.string().min(1).max(PASSWORD_MAX_LENGTH),
  })
  .strict();

export const refreshSessionRequestSchema = z
  .object({
    refreshToken: z.string().min(1),
  })
  .strict();

export const logoutRequestSchema = z
  .object({
    refreshToken: z.string().min(1),
  })
  .strict();

export const requestOtpRequestSchema = z
  .object({
    phone: phoneSchema,
  })
  .strict();

export const verifyOtpRequestSchema = z
  .object({
    phone: phoneSchema,
    code: z.string().regex(/^\d{6}$/, 'Must be a 6-digit numeric code'),
  })
  .strict();

/** POST /api/v1/admin/login — step 1 of admin sign-in (SDD 7.1: mandatory TOTP, always). Same shape as `loginRequestSchema`, kept distinct because the two are semantically different endpoints on different surfaces. */
export const adminLoginStepOneRequestSchema = z
  .object({
    email: emailSchema,
    password: z.string().min(1).max(128),
  })
  .strict();

/**
 * Never a session — only an opaque credential for step 2 (SDD 7.1). The
 * client has no use for anything about the admin account at this point; it
 * already knows the email it just submitted.
 */
export const adminLoginStepOneResponseSchema = z.object({
  mfaChallengeToken: z.string(),
  mfaChallengeTokenExpiresAt: isoDateTimeSchema,
});

/** POST /api/v1/admin/mfa/verify — step 2 of admin sign-in: the opaque challenge from step 1 plus a TOTP code, completing authentication (SDD 7.1). Success returns `authSessionResponseSchema`, same as any other login — this is the only point that ever issues an admin session. */
export const adminMfaVerifyRequestSchema = z
  .object({
    mfaChallengeToken: z.string().min(1),
    totpCode: z.string().regex(/^\d{6}$/, 'Must be a 6-digit numeric code'),
  })
  .strict();

/** POST /api/v1/admin/mfa/enroll — starts MFA enrollment for an admin with no existing secret (SDD 7.1). Same request shape as `adminLoginStepOneRequestSchema`, kept distinct as a semantically different endpoint. */
export const adminMfaEnrollRequestSchema = z
  .object({
    email: emailSchema,
    password: z.string().min(1).max(128),
  })
  .strict();

/** The plaintext secret and its `otpauth://` URI, returned exactly once — never re-shown by any other endpoint. */
export const adminMfaEnrollResponseSchema = z.object({
  secret: z.string(),
  otpauthUri: z.string(),
});

/** POST /api/v1/admin/mfa/enroll/confirm — proves possession of the enrolled secret and activates it. Success returns `authSessionResponseSchema`, same as step 2 — a completed enrollment is a completed login. */
export const adminMfaEnrollConfirmRequestSchema = z
  .object({
    email: emailSchema,
    password: z.string().min(1).max(128),
    totpCode: z.string().regex(/^\d{6}$/, 'Must be a 6-digit numeric code'),
  })
  .strict();

/**
 * The admin-family roles (SDD 8.1) — the read model's own vocabulary for
 * "what role does this administrator hold," distinct from
 * `subordinateAdminRoleSchema` below, which is deliberately narrower.
 */
export const adminRoleSchema = z.enum([
  'SUPER_ADMIN',
  'CATALOGUE_MODERATOR',
  'FINANCE_ADMIN',
  'RISK_ANALYST',
  'SUPPORT_AGENT',
]);

/**
 * The roles a SUPER_ADMIN may create through `POST /api/v1/admin/users`.
 *
 * Deliberately excludes SUPER_ADMIN. Nothing in SDD 8.1/8.2 states that the
 * admin-management flow may mint a second SUPER_ADMIN, and
 * `BootstrapAdminUseCase`'s own design — refusing to run a second time once
 * *any* admin-family account exists — treats "the platform's SUPER_ADMIN" as
 * a one-time, operator-run event, not a role this flow reproduces. Locked
 * decision (Phase L.2): creation here stays confined to the four subordinate
 * roles until a business decision explicitly says otherwise.
 */
export const subordinateAdminRoleSchema = z.enum([
  'CATALOGUE_MODERATOR',
  'FINANCE_ADMIN',
  'RISK_ANALYST',
  'SUPPORT_AGENT',
]);

/** Mirrors the domain `UserStatus` value object's four states. */
export const adminUserStatusSchema = z.enum(['PENDING', 'ACTIVE', 'SUSPENDED', 'LOCKED']);

/**
 * POST /api/v1/admin/users — SUPER_ADMIN-only creation of a subordinate
 * administrator account (SDD 8.1/8.2). Same password-policy floor as
 * customer registration (SDD 7.5) — there is no separate, laxer rule for
 * admins created this way than for the bootstrap path's own
 * `ADMIN_PASSWORD_MIN_LENGTH`, which is numerically identical.
 */
export const createAdminUserRequestSchema = z
  .object({
    email: emailSchema,
    password: z.string().min(PASSWORD_MIN_LENGTH).max(PASSWORD_MAX_LENGTH),
    role: subordinateAdminRoleSchema,
  })
  .strict();

/**
 * One administrator as another administrator sees it (GET/POST
 * `/api/v1/admin/users`).
 *
 * `.strict()` is doing the same security work it does on
 * `adminKycSubmissionDetailSchema`: a column added to `users` later (a
 * password hash is already one) fails loudly here instead of being
 * published by a spread. No MFA state, no password, no session or token
 * material — this is safe administrative metadata only.
 */
export const adminUserSchema = z
  .object({
    id: uuidSchema,
    email: emailSchema,
    role: adminRoleSchema,
    status: adminUserStatusSchema,
    createdAt: isoDateTimeSchema,
    updatedAt: isoDateTimeSchema,
  })
  .strict();

/** GET /api/v1/admin/users — the platform's existing cursor convention (SDD 9.2), same shape as `adminCategoryListQuerySchema`. */
export const listAdminUsersQuerySchema = cursorPaginationSchema.strict();

export const listAdminUsersResponseSchema = z.array(adminUserSchema);

export const authUserSchema = z.object({
  id: uuidSchema,
  email: emailSchema.optional(),
  role: roleSchema,
});

/** POST /register and /login and /refresh all return a fresh session in this shape. */
export const authSessionResponseSchema = z.object({
  user: authUserSchema,
  accessToken: z.string(),
  accessTokenExpiresAt: isoDateTimeSchema,
  refreshToken: z.string(),
  refreshTokenExpiresAt: isoDateTimeSchema,
});

export const logoutResponseSchema = z.object({
  success: z.literal(true),
});

/** POST /otp/request never returns OTP state — same uniform-response shape regardless of whether the phone is registered (SEC-15). */
export const requestOtpResponseSchema = z.object({
  success: z.literal(true),
});

/**
 * GET /me returns exactly what the verified access token's Principal
 * carries (SDD 7.4 step 1) — no email/phone, since those aren't part of the
 * token today. Deliberately not `authUserSchema`: that shape implies an
 * optional email a bare Principal can never actually supply.
 */
export const meResponseSchema = z.object({
  id: uuidSchema,
  role: roleSchema,
});

export type RoleDto = z.infer<typeof roleSchema>;
export type RegisterCustomerRequest = z.infer<typeof registerCustomerRequestSchema>;
export type LoginRequest = z.infer<typeof loginRequestSchema>;
export type AdminLoginStepOneRequest = z.infer<typeof adminLoginStepOneRequestSchema>;
export type AdminLoginStepOneResponse = z.infer<typeof adminLoginStepOneResponseSchema>;
export type AdminMfaVerifyRequest = z.infer<typeof adminMfaVerifyRequestSchema>;
export type AdminMfaEnrollRequest = z.infer<typeof adminMfaEnrollRequestSchema>;
export type AdminMfaEnrollResponse = z.infer<typeof adminMfaEnrollResponseSchema>;
export type AdminMfaEnrollConfirmRequest = z.infer<typeof adminMfaEnrollConfirmRequestSchema>;
export type AdminRoleDto = z.infer<typeof adminRoleSchema>;
export type SubordinateAdminRoleDto = z.infer<typeof subordinateAdminRoleSchema>;
export type AdminUserStatusDto = z.infer<typeof adminUserStatusSchema>;
export type CreateAdminUserRequest = z.infer<typeof createAdminUserRequestSchema>;
export type AdminUser = z.infer<typeof adminUserSchema>;
export type ListAdminUsersQuery = z.infer<typeof listAdminUsersQuerySchema>;
export type ListAdminUsersResponse = z.infer<typeof listAdminUsersResponseSchema>;
export type RefreshSessionRequest = z.infer<typeof refreshSessionRequestSchema>;
export type LogoutRequest = z.infer<typeof logoutRequestSchema>;
export type RequestOtpRequest = z.infer<typeof requestOtpRequestSchema>;
export type VerifyOtpRequest = z.infer<typeof verifyOtpRequestSchema>;
export type AuthUserDto = z.infer<typeof authUserSchema>;
export type AuthSessionResponse = z.infer<typeof authSessionResponseSchema>;
export type LogoutResponse = z.infer<typeof logoutResponseSchema>;
export type RequestOtpResponse = z.infer<typeof requestOtpResponseSchema>;
export type MeResponse = z.infer<typeof meResponseSchema>;
