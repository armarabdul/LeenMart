import { describe, expect, it } from 'vitest';
import { OtplibTotpService } from '../../../../../src/modules/identity/infrastructure/security/otplib-totp.service.js';

const NOW = new Date('2026-01-01T00:00:00.000Z');
const STEP_MS = 30_000;

describe('OtplibTotpService', () => {
  it('generates a base32 secret', () => {
    const service = new OtplibTotpService();

    const secret = service.generateSecret();

    expect(secret).toMatch(/^[A-Z2-7]+=*$/);
    expect(secret.length).toBeGreaterThan(0);
  });

  it('never generates the same secret twice', () => {
    const service = new OtplibTotpService();

    const secrets = new Set(Array.from({ length: 20 }, () => service.generateSecret()));

    expect(secrets.size).toBe(20);
  });

  it('verifies a token generated for the current step', async () => {
    const service = new OtplibTotpService();
    const secret = service.generateSecret();
    const token = await generateToken(secret, NOW);

    await expect(service.verify({ secret, token, now: NOW })).resolves.toBe(true);
  });

  it('rejects a wrong token', async () => {
    const service = new OtplibTotpService();
    const secret = service.generateSecret();
    const token = await generateToken(secret, NOW);
    const wrongToken = token === '000000' ? '111111' : '000000';

    await expect(service.verify({ secret, token: wrongToken, now: NOW })).resolves.toBe(false);
  });

  it('accepts a token from one time step in the past (±1 drift window)', async () => {
    const service = new OtplibTotpService();
    const secret = service.generateSecret();
    const oneStepAgo = new Date(NOW.getTime() - STEP_MS);
    const token = await generateToken(secret, oneStepAgo);

    await expect(service.verify({ secret, token, now: NOW })).resolves.toBe(true);
  });

  it('accepts a token from one time step in the future (±1 drift window)', async () => {
    const service = new OtplibTotpService();
    const secret = service.generateSecret();
    const oneStepAhead = new Date(NOW.getTime() + STEP_MS);
    const token = await generateToken(secret, oneStepAhead);

    await expect(service.verify({ secret, token, now: NOW })).resolves.toBe(true);
  });

  it('rejects a token two time steps outside the current window', async () => {
    const service = new OtplibTotpService();
    const secret = service.generateSecret();
    const twoStepsAgo = new Date(NOW.getTime() - STEP_MS * 2);
    const token = await generateToken(secret, twoStepsAgo);

    await expect(service.verify({ secret, token, now: NOW })).resolves.toBe(false);
  });

  it('rejects a malformed token without throwing', async () => {
    const service = new OtplibTotpService();
    const secret = service.generateSecret();

    await expect(service.verify({ secret, token: 'not-a-code', now: NOW })).resolves.toBe(false);
  });

  it('rejects a token verified against the wrong secret', async () => {
    const service = new OtplibTotpService();
    const secret = service.generateSecret();
    const otherSecret = service.generateSecret();
    const token = await generateToken(secret, NOW);

    await expect(service.verify({ secret: otherSecret, token, now: NOW })).resolves.toBe(false);
  });

  describe('generateEnrollmentUri', () => {
    it('produces an otpauth:// URI containing the secret, issuer, and account label', () => {
      const service = new OtplibTotpService();
      const secret = service.generateSecret();

      const uri = service.generateEnrollmentUri({
        secret,
        accountLabel: 'ops@leenmart.in',
        issuer: 'leen-mart-api',
      });

      expect(uri).toMatch(/^otpauth:\/\/totp\//);
      expect(uri).toContain(`secret=${secret}`);
      expect(uri).toContain('issuer=leen-mart-api');
      expect(uri).toContain('ops%40leenmart.in');
    });

    it('embeds a secret that verify() actually accepts, proving the URI is internally consistent with the approved TOTP parameters (SHA-1, 6 digits, 30s)', async () => {
      const service = new OtplibTotpService();
      const secret = service.generateSecret();
      const uri = service.generateEnrollmentUri({
        secret,
        accountLabel: 'ops@leenmart.in',
        issuer: 'leen-mart-api',
      });
      const secretFromUri = new URL(uri).searchParams.get('secret');
      const token = await generateToken(secretFromUri ?? '', NOW);

      await expect(service.verify({ secret, token, now: NOW })).resolves.toBe(true);
    });
  });
});

/**
 * Generates a real token independently of `OtplibTotpService`, using the
 * same underlying library directly with the approved parameters — so these
 * tests exercise `verify()` against tokens it did not itself produce.
 */
async function generateToken(secret: string, at: Date): Promise<string> {
  const { OTP } = await import('otplib');
  const otp = new OTP({ strategy: 'totp' });
  return otp.generate({
    secret,
    algorithm: 'sha1',
    digits: 6,
    period: 30,
    epoch: Math.floor(at.getTime() / 1000),
  });
}
