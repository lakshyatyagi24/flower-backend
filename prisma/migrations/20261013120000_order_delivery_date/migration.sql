-- AlterTable
-- Additive and nullable: existing orders keep a NULL delivery date. No default, no rewrite, no index.
-- Stored value is UTC midnight of the IST calendar date the customer chose.
ALTER TABLE "public"."Order" ADD COLUMN     "deliveryDate" TIMESTAMP(3);
