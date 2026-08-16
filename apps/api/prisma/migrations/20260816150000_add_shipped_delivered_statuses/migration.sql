-- AlterEnum
-- S3-6 (locked decision #2): delivery-mode fulfilment completion.
--
-- Split into its own migration, separate from the RLS policy widening that
-- follows in 20260816150001_widen_vendor_fulfilment_rls — PostgreSQL refuses
-- to use a freshly-added enum value inside the transaction that added it
-- ("unsafe use of new value... New enum values must be committed before they
-- can be used"), and a WITH CHECK clause referencing 'SHIPPED'/'DELIVERED'
-- counts as a use (the same reasoning 20260813230000_add_product_moderation
-- already documents for ProductStatus).
ALTER TYPE "OrderStatus" ADD VALUE 'SHIPPED';
ALTER TYPE "OrderStatus" ADD VALUE 'DELIVERED';
