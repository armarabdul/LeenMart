import { describe, expect, it } from 'vitest';
import express, { type Express, type Request, type Response } from 'express';
import request from 'supertest';
import { SystemClock } from '@leen-mart/domain-kit';
import { pino } from 'pino';
import { requirePermission } from '../../src/shared/interface/http/middleware/authorize.js';
import { createErrorHandler } from '../../src/shared/interface/http/middleware/error-handler.js';
import type { Permission } from '../../src/modules/authorization/domain/value-objects/permission.value-object.js';
import type { RoleName } from '../../src/modules/identity/domain/value-objects/role.value-object.js';
import { toSessionId } from '../../src/modules/identity/domain/value-objects/session-id.value-object.js';
import { toUserId } from '../../src/modules/identity/domain/value-objects/user-id.value-object.js';

interface ErrorBody {
  readonly error: { readonly code: string; readonly message: string };
}

/**
 * HTTP coverage for the permission middleware, over a throwaway app.
 *
 * **Deliberately not mounted on a production route.** No endpoint that exists
 * today corresponds to a permission in SDD 8.2's matrix — the 30 permissions
 * name catalogue, order, payout, fraud, moderation and KYC-review actions,
 * none of which has been built — and inventing one merely to demonstrate the
 * middleware would put an unreachable endpoint into the API surface.
 *
 * What makes this worth running as an integration test rather than a unit test
 * is that it uses the **real `createErrorHandler`**: the assertion is against
 * the envelope the platform actually returns, not against a shape this file
 * made up. If the error handler's rendering of a `ForbiddenError` ever
 * changes, this notices.
 *
 * `authenticate()` is stubbed rather than exercised — this suite is about what
 * happens *after* a principal exists. Authentication has its own coverage.
 */
const buildApp = (options: {
  permission: Permission;
  role?: RoleName;
  beforeAuthenticate?: boolean;
}): Express => {
  const app = express();
  // Silent: this suite asserts the response envelope, not the log stream.
  const logger = pino({ level: 'silent' });

  const stubAuthenticate = (req: Request, _res: Response, next: () => void): void => {
    if (options.role) {
      req.principal = {
        userId: toUserId('00000000-0000-7000-8000-0000000000f1'),
        sessionId: toSessionId('00000000-0000-7000-8000-0000000000f2'),
        role: options.role,
      };
    }
    next();
  };

  const guard = requirePermission(options.permission);
  const handler = (req: Request, res: Response): void => {
    res.status(200).json({ data: { accessLevel: req.accessLevel ?? null } });
  };

  if (options.beforeAuthenticate) {
    // The ordering mistake: the guard runs before anything establishes a
    // principal. It must fail closed rather than crash or pass.
    app.get('/probe', guard, stubAuthenticate, handler);
  } else {
    app.get('/probe', stubAuthenticate, guard, handler);
  }

  app.use(createErrorHandler(logger, new SystemClock()));
  return app;
};

describe('requirePermission over HTTP', () => {
  it('lets an allowed role reach the handler', async () => {
    const app = buildApp({ permission: 'APPROVE_OR_REJECT_VENDOR_KYC', role: 'RISK_ANALYST' });

    const response = await request(app).get('/probe').expect(200);

    expect((response.body as { data: { accessLevel: string } }).data.accessLevel).toBe('FULL');
  });

  it('surfaces OWN to the handler for step 3', async () => {
    const app = buildApp({ permission: 'SUBMIT_OR_EDIT_KYC', role: 'VENDOR_OWNER' });

    const response = await request(app).get('/probe').expect(200);

    expect((response.body as { data: { accessLevel: string } }).data.accessLevel).toBe('OWN');
  });

  it('returns the standard 403 envelope for a denied role', async () => {
    const app = buildApp({ permission: 'APPROVE_OR_REJECT_VENDOR_KYC', role: 'CUSTOMER' });

    const response = await request(app).get('/probe').expect(403);

    expect((response.body as ErrorBody).error.code).toBe('UNAUTHORIZED');
    expect((response.body as ErrorBody).error.message).toBe(
      'You are not authorized to perform this action.',
    );
  });

  it('returns 403 when no principal was ever established', async () => {
    const app = buildApp({ permission: 'BROWSE_CATALOGUE' });

    const response = await request(app).get('/probe').expect(403);

    expect((response.body as ErrorBody).error.code).toBe('UNAUTHORIZED');
  });

  it('returns 403 when mounted before authentication', async () => {
    // Fails closed on an ordering mistake rather than admitting the request.
    const app = buildApp({
      permission: 'BROWSE_CATALOGUE',
      role: 'CUSTOMER',
      beforeAuthenticate: true,
    });

    const response = await request(app).get('/probe').expect(403);

    expect((response.body as ErrorBody).error.code).toBe('UNAUTHORIZED');
  });

  it('returns 403 for a grant that requires step-up (SDD 7.5)', async () => {
    // No step-up mechanism exists, so the condition this grant depends on
    // cannot be satisfied — and treating it as an ordinary allow would drop a
    // control the SDD requires.
    const app = buildApp({ permission: 'CHANGE_PAYOUT_BANK_DETAILS', role: 'VENDOR_OWNER' });

    const response = await request(app).get('/probe').expect(403);

    expect((response.body as ErrorBody).error.code).toBe('UNAUTHORIZED');
  });

  it('returns 403 for an unrecognised permission', async () => {
    const app = buildApp({
      permission: 'NOT_A_REAL_PERMISSION' as Permission,
      role: 'SUPER_ADMIN',
    });

    await request(app).get('/probe').expect(403);
  });

  it('gives a denied caller no hint about which permission was missing', async () => {
    const app = buildApp({ permission: 'TRIGGER_SETTLEMENT_RUN', role: 'CUSTOMER' });

    const response = await request(app).get('/probe').expect(403);

    expect(JSON.stringify(response.body)).not.toContain('TRIGGER_SETTLEMENT_RUN');
    expect(JSON.stringify(response.body)).not.toContain('SETTLEMENT');
  });

  it('renders every denial identically, whatever the reason', async () => {
    // A caller must not be able to distinguish "not authenticated" from "wrong
    // role" from "needs step-up" by comparing responses.
    const missing = await request(buildApp({ permission: 'BROWSE_CATALOGUE' })).get('/probe');
    const denied = await request(
      buildApp({ permission: 'TRIGGER_SETTLEMENT_RUN', role: 'CUSTOMER' }),
    ).get('/probe');
    const stepUp = await request(
      buildApp({ permission: 'CHANGE_PAYOUT_BANK_DETAILS', role: 'VENDOR_OWNER' }),
    ).get('/probe');

    // `timestamp` legitimately differs per response; everything a caller could
    // use to tell the three cases apart must not.
    const discriminating = (body: unknown): { code: string; message: string } => {
      const { code, message } = (body as ErrorBody).error;
      return { code, message };
    };

    expect(denied.status).toBe(missing.status);
    expect(stepUp.status).toBe(missing.status);
    expect(discriminating(denied.body)).toEqual(discriminating(missing.body));
    expect(discriminating(stepUp.body)).toEqual(discriminating(missing.body));
  });
});
