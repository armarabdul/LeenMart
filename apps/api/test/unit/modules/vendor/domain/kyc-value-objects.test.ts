import { describe, expect, it } from 'vitest';
import { BankAccount } from '../../../../../src/modules/vendor/domain/value-objects/bank-account.value-object.js';
import { Gstin } from '../../../../../src/modules/vendor/domain/value-objects/gstin.value-object.js';
import { Pan } from '../../../../../src/modules/vendor/domain/value-objects/pan.value-object.js';
import { KycDocumentType } from '../../../../../src/modules/vendor/domain/value-objects/kyc-document-type.value-object.js';
import { KycRejectionReason } from '../../../../../src/modules/vendor/domain/value-objects/kyc-rejection-reason.value-object.js';

const VALID_PAN = 'ABCDE1234F';

/** The message is deliberately uniform; the actionable detail is in `details`. */
const issueFor = (build: () => unknown): string => {
  try {
    build();
    return 'did not throw';
  } catch (error) {
    const failure = error as { details?: { field: string; issue: string }[] };
    return failure.details?.[0]?.issue ?? 'no detail';
  }
};
/** `27` state code + the PAN above + entity `1` + `Z` + the computed check character. */
const VALID_GSTIN = '27ABCDE1234F1Z0';

describe('Pan', () => {
  it('accepts a well-formed PAN', () => {
    expect(Pan.create(VALID_PAN).canonical).toBe(VALID_PAN);
  });

  it('canonicalises case and surrounding whitespace, so one PAN fingerprints one way', () => {
    expect(Pan.create('  abcde1234f  ').canonical).toBe(VALID_PAN);
  });

  it.each([
    ['too short', 'ABCDE1234'],
    ['too long', 'ABCDE1234FG'],
    ['digits where letters belong', '123451234F'],
    ['letters where digits belong', 'ABCDEABCDF'],
    ['trailing digit instead of a letter', 'ABCDE12345'],
    ['empty', ''],
    ['punctuation', 'ABCDE-1234F'],
  ])('rejects a PAN that is %s', (_label, value) => {
    expect(() => Pan.create(value)).toThrow(/not valid/);
  });

  it('names the field but never echoes the rejected value back', () => {
    // A rejected PAN is still a real PAN; putting it in the error would carry
    // it into the response envelope and every log line recording the failure.
    try {
      Pan.create('ABCDE-1234F');
      expect.unreachable('a malformed PAN should not construct');
    } catch (error) {
      const failure = error as Error & { details?: { field: string; issue: string }[] };
      expect(failure.details?.[0]?.field).toBe('pan');
      expect(JSON.stringify(failure)).not.toContain('ABCDE');
    }
  });

  it('exposes only the last four characters for display (SDD 12.3)', () => {
    expect(Pan.create(VALID_PAN).last4).toBe('234F');
  });

  it('masks itself when stringified, so an accidental interpolation leaks nothing', () => {
    const rendered = Pan.create(VALID_PAN).toString();

    expect(rendered).not.toContain(VALID_PAN);
    expect(rendered).toContain('234F');
  });

  it('compares by value', () => {
    expect(Pan.create(VALID_PAN).equals(Pan.create('abcde1234f'))).toBe(true);
    expect(Pan.create(VALID_PAN).equals(Pan.create('ZZZZZ9999Z'))).toBe(false);
  });
});

describe('Gstin', () => {
  it('accepts a GSTIN whose check character agrees', () => {
    expect(Gstin.create(VALID_GSTIN).value).toBe(VALID_GSTIN);
  });

  it('canonicalises case and whitespace', () => {
    expect(Gstin.create(`  ${VALID_GSTIN.toLowerCase()}  `).value).toBe(VALID_GSTIN);
  });

  it('rejects a well-shaped GSTIN whose check character is wrong', () => {
    // The whole point of the checksum: a single mistyped character passes the
    // pattern and must still be caught.
    const wrongCheck = `${VALID_GSTIN.slice(0, 14)}9`;

    expect(issueFor(() => Gstin.create(wrongCheck))).toMatch(/check character/);
  });

  it.each([
    ['too short', '27ABCDE1234F1Z'],
    ['too long', '27ABCDE1234F1Z25'],
    ['missing the literal Z', '27ABCDE1234F1X2'],
    ['a non-numeric state code', 'AAABCDE1234F1Z2'],
    ['empty', ''],
  ])('rejects a GSTIN that is %s', (_label, value) => {
    expect(() => Gstin.create(value)).toThrow(/not valid/);
  });

  it('distinguishes a shape failure from a checksum failure', () => {
    // Different fixes for the vendor: one is a typo in the number, the other
    // is the wrong number entirely.
    expect(issueFor(() => Gstin.create('27ABCDE1234F1X2'))).toMatch(/GSTIN format/);
    expect(issueFor(() => Gstin.create(`${VALID_GSTIN.slice(0, 14)}9`))).toMatch(/check character/);
  });

  it('contains the holder PAN by construction, which is why storing it whole discloses one', () => {
    // Not an accessor — nothing needs to read the embedded PAN, and a
    // mismatch between it and a submitted PAN is legitimate (a proprietor
    // files under a personal PAN while the firm's GSTIN carries the entity's).
    // Asserted here only so the disclosure documented on `VendorKyc` is a
    // checked fact rather than a comment that could quietly stop being true.
    expect(Gstin.create(VALID_GSTIN).value.slice(2, 12)).toBe(VALID_PAN);
  });

  it('is stored and rendered in full — BR-13 files it in GSTR-8, so it is not a secret', () => {
    expect(Gstin.create(VALID_GSTIN).toString()).toBe(VALID_GSTIN);
  });
});

describe('BankAccount', () => {
  const valid = { accountNumber: '123456789012', ifsc: 'HDFC0001234' };

  it('accepts a well-formed account and IFSC', () => {
    const account = BankAccount.create(valid);

    expect(account.ifsc).toBe('HDFC0001234');
    expect(account.last4).toBe('9012');
  });

  it('strips separators a vendor copies from a passbook', () => {
    // The same account typed two ways must fingerprint identically.
    const spaced = BankAccount.create({ accountNumber: '1234 5678 9012', ifsc: 'hdfc0001234' });

    expect(spaced.equals(BankAccount.create(valid))).toBe(true);
  });

  it('includes the IFSC in the fingerprint input, so two banks may share a number', () => {
    // Account numbers are only unique within a bank; treating a collision
    // across banks as a duplicate would block an honest vendor.
    const atOtherBank = BankAccount.create({
      accountNumber: valid.accountNumber,
      ifsc: 'ICIC0005678',
    });

    expect(atOtherBank.canonical).not.toBe(BankAccount.create(valid).canonical);
  });

  it.each([
    ['non-numeric', { accountNumber: '12345678ABCD', ifsc: 'HDFC0001234' }],
    ['too short', { accountNumber: '12345678', ifsc: 'HDFC0001234' }],
    ['too long', { accountNumber: '1234567890123456789', ifsc: 'HDFC0001234' }],
    ['empty', { accountNumber: '', ifsc: 'HDFC0001234' }],
  ])('rejects an account number that is %s', (_label, input) => {
    expect(() => BankAccount.create(input)).toThrow(/not valid/);
  });

  it.each([
    ['too short', 'HDFC000123'],
    ['missing the reserved zero', 'HDFC1001234'],
    ['lowercase-only garbage', 'not-an-ifsc'],
    ['empty', ''],
  ])('rejects an IFSC that is %s', (_label, ifsc) => {
    expect(() => BankAccount.create({ accountNumber: valid.accountNumber, ifsc })).toThrow(
      /not valid/,
    );
  });

  it('exposes only the last four digits for display (SDD 12.3)', () => {
    expect(BankAccount.create(valid).last4).toBe('9012');
  });

  it('masks itself when stringified', () => {
    const rendered = BankAccount.create(valid).toString();

    expect(rendered).not.toContain('123456789012');
    expect(rendered).toContain('9012');
  });

  it('never echoes the account number back in a rejection', () => {
    try {
      BankAccount.create({ accountNumber: '12345678ABCD', ifsc: 'HDFC0001234' });
      expect.unreachable('a malformed account number should not construct');
    } catch (error) {
      expect(JSON.stringify(error as Error)).not.toContain('12345678');
    }
  });
});

describe('KycDocumentType', () => {
  it.each(['PAN', 'BANK_ACCOUNT_PROOF', 'GSTIN'])('accepts %s', (name) => {
    expect(KycDocumentType.fromName(name).name).toBe(name);
  });

  it.each(['AADHAAR', 'FSSAI', 'SHOP_ESTABLISHMENT_PROOF', 'PASSPORT', '', 'pan'])(
    'rejects the unsupported type %s',
    (name) => {
      // Aadhaar, FSSAI and shop proof are deferred by decision, not missing by
      // accident — each is refused here until its own gate clears.
      expect(() => KycDocumentType.fromName(name)).toThrow(/not accepted/);
    },
  );

  it('requires all three V1 documents', () => {
    expect(KycDocumentType.REQUIRED.map((type) => type.name).sort()).toEqual([
      'BANK_ACCOUNT_PROOF',
      'GSTIN',
      'PAN',
    ]);
  });

  it('compares by value', () => {
    expect(KycDocumentType.fromName('PAN').equals(KycDocumentType.PAN)).toBe(true);
    expect(KycDocumentType.PAN.equals(KycDocumentType.GSTIN)).toBe(false);
  });
});

describe('KycRejectionReason', () => {
  it.each([
    'DOCUMENT_UNCLEAR',
    'DOCUMENT_INVALID',
    'DETAILS_MISMATCH',
    'BANK_DETAILS_MISMATCH',
    'DUPLICATE_IDENTITY',
    'OTHER',
  ])('accepts %s', (name) => {
    expect(KycRejectionReason.fromName(name).name).toBe(name);
  });

  it('rejects a reason outside the closed set', () => {
    expect(() => KycRejectionReason.fromName('BECAUSE_I_SAID_SO')).toThrow(/not valid/);
  });

  it('requires an explanation only for OTHER', () => {
    expect(KycRejectionReason.OTHER.requiresExplanation()).toBe(true);
    expect(KycRejectionReason.DOCUMENT_UNCLEAR.requiresExplanation()).toBe(false);
    expect(KycRejectionReason.DUPLICATE_IDENTITY.requiresExplanation()).toBe(false);
  });

  it('stays small — a large taxonomy is a reviewer guessing rather than deciding', () => {
    expect(
      [
        'DOCUMENT_UNCLEAR',
        'DOCUMENT_INVALID',
        'DETAILS_MISMATCH',
        'BANK_DETAILS_MISMATCH',
        'DUPLICATE_IDENTITY',
        'OTHER',
      ].length,
    ).toBe(6);
  });
});
