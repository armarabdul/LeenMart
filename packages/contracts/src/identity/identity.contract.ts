import { z } from 'zod';
import { emailSchema, isoDateTimeSchema, phoneSchema, uuidSchema } from '../common/primitives.js';

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

export const registerCustomerRequestSchema = z
  .object({
    email: emailSchema,
    password: z.string().min(8).max(128),
  })
  .strict();

export const loginRequestSchema = z
  .object({
    email: emailSchema,
    password: z.string().min(1).max(128),
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
export type RefreshSessionRequest = z.infer<typeof refreshSessionRequestSchema>;
export type LogoutRequest = z.infer<typeof logoutRequestSchema>;
export type RequestOtpRequest = z.infer<typeof requestOtpRequestSchema>;
export type VerifyOtpRequest = z.infer<typeof verifyOtpRequestSchema>;
export type AuthUserDto = z.infer<typeof authUserSchema>;
export type AuthSessionResponse = z.infer<typeof authSessionResponseSchema>;
export type LogoutResponse = z.infer<typeof logoutResponseSchema>;
export type RequestOtpResponse = z.infer<typeof requestOtpResponseSchema>;
export type MeResponse = z.infer<typeof meResponseSchema>;
