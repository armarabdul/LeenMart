-- CreateEnum
CREATE TYPE "VendorStatus" AS ENUM ('REGISTERED', 'KYC_SUBMITTED', 'KYC_UNDER_REVIEW', 'KYC_REJECTED', 'KYC_APPROVED', 'ACTIVE', 'SUSPENDED', 'TERMINATED');

-- CreateTable
CREATE TABLE "vendors" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "status" "VendorStatus" NOT NULL DEFAULT 'REGISTERED',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "vendors_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "vendors_user_id_key" ON "vendors"("user_id");

-- AddForeignKey
ALTER TABLE "vendors" ADD CONSTRAINT "vendors_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
