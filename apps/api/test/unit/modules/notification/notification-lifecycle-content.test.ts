import { describe, expect, it } from 'vitest';
import {
  contentFor,
  subjectIdFieldOf,
  subjectOf,
} from '../../../../src/modules/notification/domain/services/notification-policy.js';

const PRODUCT_ID = '01a01234-5678-7abc-9def-0123456789ab';

/**
 * The wording of the four lifecycle notifications (S6-NOTIFY-LIFECYCLE).
 *
 * The locked decision these all defend: **a rejection notification says the
 * decision went that way and nothing more.** The coded reason and the
 * reviewer's free-text note stay in the moderation surface the vendor already
 * has. `DecideProductUseCase` and `DecideVendorKycUseCase` already keep the
 * reviewer's prose out of the audit row and the log line; this is the same
 * restraint on the one surface the vendor actually reads.
 */
describe('lifecycle notification content (S6-NOTIFY-LIFECYCLE)', () => {
  const REVIEWER_WORDS = [
    'reason',
    'note',
    'reviewer',
    'moderator',
    'because',
    'blurry',
    'counterfeit',
    'prohibited',
    'PROHIBITED_ITEM',
    'IMAGE_QUALITY',
    'admin',
  ];

  it('names the product for a product decision, and nothing else', () => {
    const approved = contentFor('product.approved', { subjectId: PRODUCT_ID });

    expect(approved.title).toBe('Product approved');
    expect(approved.body).toContain(PRODUCT_ID.slice(-8).toUpperCase());
    // The full key never appears — same rule the order notifications follow.
    expect(approved.body).not.toContain(PRODUCT_ID);
  });

  it.each(['product.rejected', 'kyc.rejected'] as const)(
    '%s states the outcome without a reason, a note, or anything a reviewer wrote',
    (eventType) => {
      const { title, body } = contentFor(eventType, { subjectId: PRODUCT_ID });
      const text = `${title} ${body}`.toLowerCase();

      for (const word of REVIEWER_WORDS) {
        expect(text).not.toContain(word.toLowerCase());
      }
    },
  );

  it('gives each of the four its own wording', () => {
    const titles = (
      ['product.approved', 'product.rejected', 'kyc.approved', 'kyc.rejected'] as const
    ).map((eventType) => contentFor(eventType, { subjectId: PRODUCT_ID }).title);

    expect(new Set(titles).size).toBe(4);
  });

  it('says nothing a vendor could mistake for an instruction', () => {
    // Same rule the order notifications follow: the moderation page is where
    // the vendor acts; this only tells them something happened.
    for (const eventType of ['product.approved', 'product.rejected'] as const) {
      const { body } = contentFor(eventType, { subjectId: PRODUCT_ID });
      expect(body).not.toMatch(/click|tap|please|sorry|contact/i);
    }
  });

  it('needs no reference for a KYC decision — a vendor has exactly one verification status', () => {
    const { body } = contentFor('kyc.approved', { subjectId: null });

    expect(body).toBe('Your shop verification has been approved.');
    // No stray reference, and no empty-placeholder artefact left behind.
    expect(body).not.toMatch(/\s{2}|\bundefined\b|\bnull\b/);
  });

  it('maps each event to the subject that decides how its recipients resolve', () => {
    expect(subjectOf('product.approved')).toBe('PRODUCT');
    expect(subjectOf('kyc.rejected')).toBe('VENDOR_KYC');
    expect(subjectOf('order.placed')).toBe('ORDER');

    expect(subjectIdFieldOf('PRODUCT')).toBe('productId');
    expect(subjectIdFieldOf('ORDER')).toBe('orderId');
    expect(subjectIdFieldOf('VENDOR_KYC')).toBeNull();
  });
});
