import { describe, expect, it } from 'vitest';
import {
  contentFor,
  subjectIdFieldOf,
  subjectOf,
} from '../../../../src/modules/notification/domain/services/notification-policy.js';

const PRODUCT_ID = '01a01234-5678-7abc-9def-0123456789ab';

/**
 * The wording of the one review notification (S9-NOTIFY-REVIEW).
 *
 * The locked decision this defends: the notification says a review arrived
 * for a named product, and **nothing else** — no rating, no review body, no
 * customer name or id, no reviewer identity of any kind, and no moderation
 * detail (there is none to leak here; the event fires on submission, before
 * any moderation has happened at all).
 */
describe('review notification content (S9-NOTIFY-REVIEW)', () => {
  it('names the product a review arrived for, and nothing else', () => {
    const content = contentFor('review.received', { subjectId: PRODUCT_ID });

    expect(content.title).toBe('New review');
    expect(content.body).toContain(PRODUCT_ID.slice(-8).toUpperCase());
    // The full key never appears — same rule every other event's reference follows.
    expect(content.body).not.toContain(PRODUCT_ID);
  });

  it('carries no review content, no rating, and no customer identity — because contentFor is never given any', () => {
    // `contentFor` receives only `{ subjectId }`. There is no reviewer,
    // rating or body parameter for the review module to ever pass one
    // through by mistake — the leak this guards against is structurally
    // unrepresentable, not just avoided by convention.
    const { title, body } = contentFor('review.received', { subjectId: PRODUCT_ID });
    const text = `${title} ${body}`.toLowerCase();

    const forbidden = ['rating', 'star', 'wrote', 'said', 'customer', 'reviewer', 'comment', '★'];
    for (const word of forbidden) {
      expect(text).not.toContain(word);
    }
    // No digit survives beyond the product's own short reference (a rating
    // 1-5 would otherwise be indistinguishable from a leaked figure).
    expect(text.replace(PRODUCT_ID.slice(-8).toLowerCase(), '')).not.toMatch(/\d/);
  });

  it('says nothing a vendor could mistake for an instruction', () => {
    const { body } = contentFor('review.received', { subjectId: PRODUCT_ID });
    expect(body).not.toMatch(/click|tap|please|sorry|contact/i);
  });

  it('reuses the PRODUCT subject — the same one product.approved/product.rejected already use, so recipient resolution needs no new branch', () => {
    expect(subjectOf('review.received')).toBe('PRODUCT');
    expect(subjectIdFieldOf(subjectOf('review.received'))).toBe('productId');
  });
});
