import { describe, expect, it, vi } from 'vitest';
import type { NextFunction, Request, Response } from 'express';
import { requirePermission } from '../../../src/shared/interface/http/middleware/authorize.js';
import type { Permission } from '../../../src/modules/authorization/domain/value-objects/permission.value-object.js';
import type { RoleName } from '../../../src/modules/identity/domain/value-objects/role.value-object.js';
import { UnauthorizedError } from '../../../src/modules/identity/domain/errors/identity-errors.js';
import { toSessionId } from '../../../src/modules/identity/domain/value-objects/session-id.value-object.js';
import { toUserId } from '../../../src/modules/identity/domain/value-objects/user-id.value-object.js';

const userId = toUserId('00000000-0000-7000-8000-0000000000a1');
const sessionId = toSessionId('00000000-0000-7000-8000-0000000000a2');

const requestFor = (role?: RoleName): Request =>
  ({ ...(role ? { principal: { userId, sessionId, role } } : {}) }) as Request;

/** Runs the middleware and reports what it did, without an HTTP server. */
const run = (
  permission: Permission,
  role?: RoleName,
): { request: Request; error: unknown; passed: boolean } => {
  const request = requestFor(role);
  let error: unknown;
  let passed = false;
  const next: NextFunction = ((caught?: unknown) => {
    if (caught) error = caught;
    else passed = true;
  }) as NextFunction;

  requirePermission(permission)(request, {} as Response, next);
  return { request, error, passed };
};

describe('requirePermission (SDD 7.4 step 2)', () => {
  describe('allow', () => {
    it('lets a role through when the matrix grants the permission', () => {
      const { passed, error } = run('APPROVE_OR_REJECT_VENDOR_KYC', 'RISK_ANALYST');

      expect(passed).toBe(true);
      expect(error).toBeUndefined();
    });

    it.each([
      ['SUPER_ADMIN', 'SUSPEND_VENDOR_OR_USER'],
      ['CUSTOMER', 'BROWSE_CATALOGUE'],
      ['VENDOR_OWNER', 'SUBMIT_OR_EDIT_KYC'],
    ] as [RoleName, Permission][])('lets %s through for %s', (role, permission) => {
      expect(run(permission, role).passed).toBe(true);
    });
  });

  describe('deny', () => {
    it('denies a role the matrix does not grant', () => {
      const { passed, error } = run('APPROVE_OR_REJECT_VENDOR_KYC', 'CUSTOMER');

      expect(passed).toBe(false);
      expect(error).toBeInstanceOf(UnauthorizedError);
    });

    it.each([
      ['VENDOR_STAFF', 'SUBMIT_OR_EDIT_KYC'],
      ['SUPPORT_AGENT', 'APPROVE_OR_REJECT_VENDOR_KYC'],
      ['CUSTOMER', 'MANAGE_VENDOR_STAFF'],
    ] as [RoleName, Permission][])('denies %s for %s', (role, permission) => {
      expect(run(permission, role).error).toBeInstanceOf(UnauthorizedError);
    });

    it('denies when no principal is present', () => {
      // An ordering mistake — mounted before `authenticate()` — must fail
      // closed rather than read `undefined.role` or, worse, pass.
      const { passed, error } = run('BROWSE_CATALOGUE');

      expect(passed).toBe(false);
      expect(error).toBeInstanceOf(UnauthorizedError);
    });

    it('denies an unrecognised permission', () => {
      // Only reachable by bypassing the closed `Permission` type, e.g. from an
      // unvalidated external value. Deny-by-default is what makes that safe.
      const { passed, error } = run('NOT_A_REAL_PERMISSION' as Permission, 'SUPER_ADMIN');

      expect(passed).toBe(false);
      expect(error).toBeInstanceOf(UnauthorizedError);
    });

    it('denies an unrecognised role', () => {
      expect(run('BROWSE_CATALOGUE', 'NOT_A_ROLE' as RoleName).error).toBeInstanceOf(
        UnauthorizedError,
      );
    });

    it('never says which permission was missing', () => {
      // A caller learning *which* grant they lack learns the shape of the
      // permission model, and the answer is the same to them either way.
      const { error } = run('TRIGGER_SETTLEMENT_RUN', 'CUSTOMER');
      const failure = error as UnauthorizedError;

      expect(failure.message).not.toContain('TRIGGER_SETTLEMENT_RUN');
      expect(JSON.stringify(failure)).not.toContain('TRIGGER_SETTLEMENT_RUN');
      expect(failure.code).toBe('UNAUTHORIZED');
      expect(failure.kind).toBe('FORBIDDEN');
    });

    it('produces the identical error for every distinct denial reason', () => {
      const missingPrincipal = run('BROWSE_CATALOGUE').error as UnauthorizedError;
      const deniedRole = run('TRIGGER_SETTLEMENT_RUN', 'CUSTOMER').error as UnauthorizedError;

      expect(deniedRole.message).toBe(missingPrincipal.message);
      expect(deniedRole.code).toBe(missingPrincipal.code);
    });
  });

  describe('step-up (SDD 7.5)', () => {
    it('denies a grant that requires step-up, because no step-up mechanism exists', () => {
      // SDD 8.2's one annotated cell. Letting it through would treat a
      // conditional grant as an unconditional one and silently drop a control
      // the SDD requires.
      const { passed, error } = run('CHANGE_PAYOUT_BANK_DETAILS', 'VENDOR_OWNER');

      expect(passed).toBe(false);
      expect(error).toBeInstanceOf(UnauthorizedError);
    });

    it('does not attach an access level when it denies for step-up', () => {
      expect(run('CHANGE_PAYOUT_BANK_DETAILS', 'VENDOR_OWNER').request.accessLevel).toBeUndefined();
    });

    it('still allows the same permission for a role that carries no step-up flag', () => {
      // SUPER_ADMIN holds `CHANGE_PAYOUT_BANK_DETAILS` as READ_ONLY without
      // the annotation, so the refusal above is about that particular *grant*,
      // not about the action.
      const { passed, request } = run('CHANGE_PAYOUT_BANK_DETAILS', 'SUPER_ADMIN');

      expect(passed).toBe(true);
      expect(request.accessLevel).toBe('READ_ONLY');
    });
  });

  describe('access level, for step 3', () => {
    it('exposes OWN so the application layer can scope to the caller', () => {
      const { request } = run('SUBMIT_OR_EDIT_KYC', 'VENDOR_OWNER');

      expect(request.accessLevel).toBe('OWN');
    });

    it('exposes FULL', () => {
      const { request } = run('APPROVE_OR_REJECT_VENDOR_KYC', 'RISK_ANALYST');

      expect(request.accessLevel).toBe('FULL');
    });

    it('exposes READ_ONLY', () => {
      const { request } = run('APPROVE_OR_REJECT_VENDOR_KYC', 'CATALOGUE_MODERATOR');

      expect(request.accessLevel).toBe('READ_ONLY');
    });

    it('leaves it unset on denial', () => {
      expect(run('APPROVE_OR_REJECT_VENDOR_KYC', 'CUSTOMER').request.accessLevel).toBeUndefined();
    });
  });

  describe('what it must not do', () => {
    it('reads nothing but the principal off the request', () => {
      // Step 3 is the application layer's job (SDD 7.4): a middleware that
      // reached for the resource would do ownership checking in the wrong
      // place and make the repository tenant scoping behind it redundant.
      const request = requestFor('RISK_ANALYST');
      const seen = new Set<string>();
      const watched = new Proxy(request, {
        get(target, property: string) {
          seen.add(property);
          return Reflect.get(target, property) as unknown;
        },
      });

      requirePermission('APPROVE_OR_REJECT_VENDOR_KYC')(
        watched,
        {} as Response,
        (() => undefined) as NextFunction,
      );

      expect([...seen]).toEqual(['principal']);
      expect(seen.has('params')).toBe(false);
      expect(seen.has('body')).toBe(false);
      expect(seen.has('query')).toBe(false);
    });

    it('is synchronous, so it cannot be awaiting any I/O', () => {
      // The cheapest proof that no database or repository call happens: there
      // is nothing to await.
      const result = requirePermission('BROWSE_CATALOGUE')(
        requestFor('CUSTOMER'),
        {} as Response,
        (() => undefined) as NextFunction,
      );

      expect(result).toBeUndefined();
    });

    it('does not touch the response object', () => {
      // Refusal travels through `next(error)` to the shared error handler, so
      // every 403 in the platform is rendered by one piece of code.
      const response = new Proxy({} as Response, {
        get() {
          throw new Error('the middleware must not touch the response');
        },
      });

      expect(() =>
        requirePermission('TRIGGER_SETTLEMENT_RUN')(
          requestFor('CUSTOMER'),
          response,
          (() => undefined) as NextFunction,
        ),
      ).not.toThrow();
    });

    it('calls next exactly once', () => {
      const next = vi.fn();

      requirePermission('BROWSE_CATALOGUE')(requestFor('CUSTOMER'), {} as Response, next);

      expect(next).toHaveBeenCalledTimes(1);
    });
  });
});
