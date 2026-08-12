-- Vendor KYC persistence (KYC-2A): the tables behind the KYC-1 domain model.
--
-- Purely additive. No existing table, column, index or constraint is touched,
-- so nothing already in `vendors`, `users` or anywhere else can be lost by
-- applying this. There is no backfill: both tables are new and start empty.
--
-- Row-level security is deliberately NOT part of this migration. The
-- application's database role is SUPERUSER with BYPASSRLS, which makes any
-- policy written here provably inert, and the codebase has no
-- transaction-scoped tenant identity to write a policy against. Both are
-- KYC-2B's problem; pretending otherwise here would ship a control that
-- silently does nothing.

-- CreateEnum
CREATE TYPE "KycDocumentType" AS ENUM ('PAN', 'BANK_ACCOUNT_PROOF', 'GSTIN');

-- CreateEnum
CREATE TYPE "KycDocumentUploadStatus" AS ENUM ('AWAITING_UPLOAD', 'UPLOADED');

-- CreateEnum
CREATE TYPE "KycRejectionReason" AS ENUM ('DOCUMENT_UNCLEAR', 'DOCUMENT_INVALID', 'DETAILS_MISMATCH', 'BANK_DETAILS_MISMATCH', 'DUPLICATE_IDENTITY', 'OTHER');

-- CreateTable
CREATE TABLE "vendor_kyc_submissions" (
    "id" UUID NOT NULL,
    "vendor_id" UUID NOT NULL,
    "pan_fingerprint" VARCHAR(64) NOT NULL,
    "pan_last4" VARCHAR(4) NOT NULL,
    "gstin" VARCHAR(15) NOT NULL,
    "bank_fingerprint" VARCHAR(64) NOT NULL,
    "bank_account_last4" VARCHAR(4) NOT NULL,
    "ifsc" VARCHAR(11) NOT NULL,
    "reviewed_by" UUID,
    "started_at" TIMESTAMPTZ(6),
    "decided_by" UUID,
    "decided_at" TIMESTAMPTZ(6),
    "rejection_reason" "KycRejectionReason",
    "rejection_note" TEXT,
    "submitted_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "vendor_kyc_submissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kyc_documents" (
    "id" UUID NOT NULL,
    "kyc_id" UUID NOT NULL,
    "vendor_id" UUID NOT NULL,
    "type" "KycDocumentType" NOT NULL,
    "object_key" VARCHAR(1024) NOT NULL,
    "wrapped_data_key" BYTEA NOT NULL,
    "content_type" VARCHAR(255) NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "status" "KycDocumentUploadStatus" NOT NULL DEFAULT 'AWAITING_UPLOAD',
    "uploaded_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "kyc_documents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_vendor_kyc_vendor_history" ON "vendor_kyc_submissions"("vendor_id", "submitted_at" DESC);

-- CreateIndex
CREATE INDEX "idx_vendor_kyc_pan_fingerprint" ON "vendor_kyc_submissions"("pan_fingerprint");

-- CreateIndex
CREATE INDEX "idx_vendor_kyc_bank_fingerprint" ON "vendor_kyc_submissions"("bank_fingerprint");

-- CreateIndex
CREATE UNIQUE INDEX "uq_vendor_kyc_id_vendor" ON "vendor_kyc_submissions"("id", "vendor_id");

-- CreateIndex
CREATE INDEX "idx_kyc_documents_vendor" ON "kyc_documents"("vendor_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_kyc_documents_one_per_type" ON "kyc_documents"("kyc_id", "type");

-- AddForeignKey
ALTER TABLE "vendor_kyc_submissions" ADD CONSTRAINT "vendor_kyc_submissions_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_kyc_submissions" ADD CONSTRAINT "vendor_kyc_submissions_reviewed_by_fkey" FOREIGN KEY ("reviewed_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_kyc_submissions" ADD CONSTRAINT "vendor_kyc_submissions_decided_by_fkey" FOREIGN KEY ("decided_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
-- Composite, referencing `uq_vendor_kyc_id_vendor`. This is what makes
-- `kyc_documents.vendor_id` safe to denormalise: a document whose vendor_id
-- disagrees with its parent submission's has no row to reference and is
-- refused. The column cannot drift, so it never becomes a second, quietly
-- wrong answer to "whose document is this".
ALTER TABLE "kyc_documents" ADD CONSTRAINT "kyc_documents_kyc_id_vendor_id_fkey" FOREIGN KEY ("kyc_id", "vendor_id") REFERENCES "vendor_kyc_submissions"("id", "vendor_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Hand-written beyond this point: Prisma's schema DSL has no WHERE clause for
-- indexes and no CHECK constraints, so none of the following can be generated
-- from schema.prisma. Same situation, and same treatment, as
-- `idx_addresses_one_default_per_user`.
-- ---------------------------------------------------------------------------

-- CreateIndex
-- THE central invariant: a vendor has many submissions over time, but at most
-- one that has not been decided.
--
-- `decided_at IS NULL` is the correct predicate for "undecided" because it
-- holds in *every* legal pre-decision state of the KYC-1 aggregate, and only
-- those: a submission with no review yet (review is null), and a submission
-- claimed but not decided (started_at set, decided_at still null). Both must
-- block a second attempt, and both do. `reviewed_by IS NULL` would have been
-- wrong — it stops holding the moment a reviewer claims the submission, which
-- would let a vendor submit again mid-review.
--
-- In the database rather than the application because the application cannot
-- enforce it: two concurrent submissions both read "no undecided attempt",
-- both pass, and both insert. Here the second one loses.
CREATE UNIQUE INDEX "uq_vendor_kyc_one_undecided" ON "vendor_kyc_submissions"("vendor_id") WHERE "decided_at" IS NULL;

-- AddConstraint
-- The reviewer and the moment of claiming arrive together or not at all.
ALTER TABLE "vendor_kyc_submissions" ADD CONSTRAINT "ck_vendor_kyc_review_pair"
    CHECK (("reviewed_by" IS NULL) = ("started_at" IS NULL));

-- AddConstraint
-- So do the decider and the moment of deciding. Without this, a row could
-- record a decision with nobody's name on it, which is exactly what SDD 15.1
-- requires never to happen.
ALTER TABLE "vendor_kyc_submissions" ADD CONSTRAINT "ck_vendor_kyc_decision_pair"
    CHECK (("decided_by" IS NULL) = ("decided_at" IS NULL));

-- AddConstraint
-- A decision requires a claimed review. The aggregate refuses this already;
-- this is the database refusing it too, for writes that did not come through
-- the aggregate.
ALTER TABLE "vendor_kyc_submissions" ADD CONSTRAINT "ck_vendor_kyc_decision_needs_review"
    CHECK ("decided_at" IS NULL OR "started_at" IS NOT NULL);

-- AddConstraint
-- A rejection reason only exists on a decided row, and OTHER — the one reason
-- that tells a vendor nothing on its own — must carry an explanation.
--
-- Written so every branch evaluates to a genuine boolean. A CHECK that
-- evaluates to NULL *passes*, so `length(btrim(NULL)) > 0` would have let an
-- unexplained OTHER through the exact constraint meant to catch it; `coalesce`
-- and the `IS NOT NULL` guard are what keep the expression total.
ALTER TABLE "vendor_kyc_submissions" ADD CONSTRAINT "ck_vendor_kyc_rejection_shape"
    CHECK (
        ("rejection_reason" IS NULL AND "rejection_note" IS NULL)
        OR (
            "rejection_reason" IS NOT NULL
            AND "decided_at" IS NOT NULL
            AND ("rejection_reason" <> 'OTHER' OR coalesce(btrim("rejection_note"), '') <> '')
        )
    );

-- AddConstraint
-- A document is uploaded exactly when it has an upload time.
ALTER TABLE "kyc_documents" ADD CONSTRAINT "ck_kyc_documents_upload_pair"
    CHECK (("status" = 'UPLOADED') = ("uploaded_at" IS NOT NULL));

-- AddConstraint
-- Mirrors the domain's own guard. A zero-byte or negative object is not a
-- document, and 10 MB is the ceiling KYC-0's presigned upload enforces.
ALTER TABLE "kyc_documents" ADD CONSTRAINT "ck_kyc_documents_size"
    CHECK ("size_bytes" > 0 AND "size_bytes" <= 10485760);
