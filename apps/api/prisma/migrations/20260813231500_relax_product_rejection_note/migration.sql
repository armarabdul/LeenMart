-- Corrective migration (S2-5 review fix). Never edit an already-applied
-- migration in place — that leaves `_prisma_migrations`' recorded checksum
-- disagreeing with the file on disk and breaks history for every other
-- environment that already applied it. This is a follow-up instead.
--
-- 20260813230001_add_product_moderation_constraints over-constrained
-- `chk_products_rejection_requires_reason_and_note`: it required a non-blank
-- `rejection_note` for every `REJECTED` row. SDD 15.2 says, verbatim,
-- "a structured reason code plus optional free text" — the note was never
-- meant to be mandatory, only the reason code is. This corrects the
-- constraint to that invariant:
--
--   REJECTED     -> rejection_reason IS NOT NULL, rejection_note unconstrained
--   non-REJECTED -> rejection_reason IS NULL AND rejection_note IS NULL
--
-- Safe to apply over existing data without a backfill: every row that
-- satisfied the old (stricter) constraint already satisfies this looser one.

ALTER TABLE "products" DROP CONSTRAINT "chk_products_rejection_requires_reason_and_note";

ALTER TABLE "products"
    ADD CONSTRAINT "chk_products_rejection_requires_reason_and_note"
        CHECK (
            ("status" = 'REJECTED' AND "rejection_reason" IS NOT NULL)
            OR
            ("status" <> 'REJECTED' AND "rejection_reason" IS NULL AND "rejection_note" IS NULL)
        );
