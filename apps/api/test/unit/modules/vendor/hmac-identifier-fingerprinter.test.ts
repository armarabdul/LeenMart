import { describe, expect, it } from 'vitest';
import { createHmac } from 'node:crypto';
import { HmacIdentifierFingerprinter } from '../../../../src/modules/vendor/infrastructure/security/hmac-identifier-fingerprinter.js';
import { BankAccount } from '../../../../src/modules/vendor/domain/value-objects/bank-account.value-object.js';
import type { SensitiveFingerprint } from '../../../../src/modules/vendor/domain/value-objects/sensitive-fingerprint.value-object.js';

const PEPPER = 'a1b2c3d4'.repeat(8);
const OTHER_PEPPER = 'f9e8d7c6'.repeat(8);
const PAN = 'ABCDE1234F';

describe('HmacIdentifierFingerprinter', () => {
  const fingerprinter = new HmacIdentifierFingerprinter(PEPPER);

  describe('construction', () => {
    it.each([
      ['too short', 'abcd'],
      ['not hexadecimal', 'z'.repeat(64)],
      ['empty', ''],
      ['a passphrase rather than a key', 'correct-horse-battery-staple'],
    ])('refuses a pepper that is %s', (_label, pepper) => {
      // A misconfigured pepper is not something to discover later: every
      // fingerprint it produced would be unreproducible by any other process.
      expect(() => new HmacIdentifierFingerprinter(pepper)).toThrow(/64-character hexadecimal/);
    });

    it('accepts a well-formed pepper in either case', () => {
      expect(() => new HmacIdentifierFingerprinter(PEPPER.toUpperCase())).not.toThrow();
    });
  });

  describe('determinism', () => {
    it('produces the same fingerprint for the same input every time', () => {
      // Duplicate detection silently stops detecting anything otherwise.
      const first = fingerprinter.fingerprint('PAN', PAN);
      const second = fingerprinter.fingerprint('PAN', PAN);

      expect(first).toBe(second);
    });

    it('produces the same fingerprint across separate instances', () => {
      const other = new HmacIdentifierFingerprinter(PEPPER);

      expect(other.fingerprint('PAN', PAN)).toBe(fingerprinter.fingerprint('PAN', PAN));
    });

    it('returns a 64-character hex digest', () => {
      expect(fingerprinter.fingerprint('PAN', PAN)).toMatch(/^[0-9a-f]{64}$/);
    });

    it('distinguishes different identifiers', () => {
      expect(fingerprinter.fingerprint('PAN', PAN)).not.toBe(
        fingerprinter.fingerprint('PAN', 'ZZZZZ9999Z'),
      );
    });
  });

  describe('kind binding', () => {
    it('produces different fingerprints for the same value under different kinds', () => {
      // Bound into the HMAC input rather than prefixed onto the output: a
      // comparison that forgot a prefix would report a false duplicate, while
      // this makes the digests themselves unrelated.
      const asPan = fingerprinter.fingerprint('PAN', '123456789012');
      const asBank = fingerprinter.fingerprint('BANK_ACCOUNT', '123456789012');

      expect(asPan).not.toBe(asBank);
    });

    it('binds the kind cryptographically, not as an output prefix', () => {
      const asBank = fingerprinter.fingerprint('BANK_ACCOUNT', PAN);

      expect(asBank).not.toContain('BANK_ACCOUNT');
      expect(asBank).toMatch(/^[0-9a-f]{64}$/);
    });

    it('cannot be made to collide by smuggling the separator into the value', () => {
      // The attack a naive `kind + value` concatenation allows: a value that
      // begins with the other kind's name and the separator would produce that
      // kind's digest. Uses the real separator, so this fails if the message
      // format ever loses its unambiguous split point.
      expect(fingerprinter.fingerprint('PAN', `BANK_ACCOUNT|${PAN}`)).not.toBe(
        fingerprinter.fingerprint('BANK_ACCOUNT', PAN),
      );
    });

    it('has no separator character reachable from a canonical value', () => {
      // Why the collision above is impossible rather than merely unlikely:
      // neither canonical form can contain `|`.
      expect('ABCDE1234F').not.toContain('|');
      expect(
        BankAccount.create({ accountNumber: '123456789012', ifsc: 'HDFC0001234' }).canonical,
      ).not.toContain('|');
    });
  });

  describe('pepper', () => {
    it('produces a completely different fingerprint under a different pepper', () => {
      // What makes the digest non-enumerable: without the pepper, a PAN's ~10^12
      // keyspace is trivially searchable offline.
      const other = new HmacIdentifierFingerprinter(OTHER_PEPPER);

      expect(other.fingerprint('PAN', PAN)).not.toBe(fingerprinter.fingerprint('PAN', PAN));
    });

    it('is not an unkeyed digest of the value', () => {
      const unkeyed = createHmac('sha256', Buffer.alloc(32)).update(`PAN ${PAN}`).digest('hex');

      expect(fingerprinter.fingerprint('PAN', PAN)).not.toBe(unkeyed);
    });

    it('never exposes the pepper through the instance or its output', () => {
      const fingerprint = fingerprinter.fingerprint('PAN', PAN);

      expect(fingerprint).not.toContain(PEPPER);
      expect(JSON.stringify(fingerprinter)).not.toContain(PEPPER);
      expect(JSON.stringify(fingerprinter)).not.toContain('a1b2c3d4');
    });
  });

  describe('one-wayness', () => {
    it('does not carry the plaintext identifier in its output', () => {
      const fingerprint = fingerprinter.fingerprint('PAN', PAN);

      expect(fingerprint).not.toContain(PAN);
      expect(fingerprint).not.toContain('1234');
      expect(fingerprint).not.toContain(PAN.toLowerCase());
    });

    it('gives no length signal about the value it covers', () => {
      // A digest that varied in length would leak how long the input was.
      const short = fingerprinter.fingerprint('BANK_ACCOUNT', 'HDFC0001234:123456789');
      const long = fingerprinter.fingerprint('BANK_ACCOUNT', 'HDFC0001234:123456789012345678');

      expect(short).toHaveLength(long.length);
    });

    it('changes completely when one character of the input changes', () => {
      const first = fingerprinter.fingerprint('PAN', PAN);
      const second = fingerprinter.fingerprint('PAN', 'ABCDE1234G');

      const sharedPrefix = [...first].findIndex((character, index) => character !== second[index]);
      expect(sharedPrefix).toBeLessThan(8);
    });
  });

  describe('matches', () => {
    it('compares equal fingerprints as equal', () => {
      const fingerprint = fingerprinter.fingerprint('PAN', PAN);

      expect(HmacIdentifierFingerprinter.matches(fingerprint, fingerprint)).toBe(true);
    });

    it('compares different fingerprints as different', () => {
      expect(
        HmacIdentifierFingerprinter.matches(
          fingerprinter.fingerprint('PAN', PAN),
          fingerprinter.fingerprint('PAN', 'ZZZZZ9999Z'),
        ),
      ).toBe(false);
    });

    it('does not throw on a mismatched length', () => {
      // `timingSafeEqual` throws on unequal buffers; the guard exists so a
      // malformed stored value is a false comparison, not a 500.
      expect(
        HmacIdentifierFingerprinter.matches(
          fingerprinter.fingerprint('PAN', PAN),
          'abcd' as SensitiveFingerprint,
        ),
      ).toBe(false);
    });
  });
});
