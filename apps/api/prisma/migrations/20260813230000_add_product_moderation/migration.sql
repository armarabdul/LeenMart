-- AlterEnum
-- S2-5: the moderation core (SDD 15.2). PUBLISHED/UNPUBLISHED/DELISTED stay
-- withheld — see schema.prisma's ProductStatus comment for why.
--
-- Split into its own migration, separate from the CHECK constraint that
-- follows in 20260813230001_add_product_moderation_constraints: PostgreSQL
-- refuses to use a freshly-added enum value inside the transaction that added
-- it ("unsafe use of new value... New enum values must be committed before
-- they can be used"), and a CHECK constraint referencing 'REJECTED' counts as
-- a use.
ALTER TYPE "ProductStatus" ADD VALUE 'PENDING_REVIEW';
ALTER TYPE "ProductStatus" ADD VALUE 'APPROVED';
ALTER TYPE "ProductStatus" ADD VALUE 'REJECTED';

-- CreateEnum
CREATE TYPE "ProductRejectionReason" AS ENUM ('INCOMPLETE_MANDATORY_FIELDS', 'POLICY_VIOLATION', 'MISLEADING_LISTING', 'DUPLICATE_LISTING', 'PRICING_ISSUE', 'OTHER');

-- AlterTable
ALTER TABLE "products" ADD COLUMN "rejection_reason" "ProductRejectionReason";
ALTER TABLE "products" ADD COLUMN "rejection_note" TEXT;
