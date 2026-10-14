-- CreateEnum
CREATE TYPE "public"."CouponType" AS ENUM ('PERCENT', 'FLAT');

-- CreateTable
CREATE TABLE "public"."Coupon" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "type" "public"."CouponType" NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "minSubtotal" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "maxDiscount" DOUBLE PRECISION,
    "expiresAt" TIMESTAMP(3),
    "maxUses" INTEGER,
    "usedCount" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Coupon_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Coupon_code_key" ON "public"."Coupon"("code");

-- AlterTable
-- Additive: existing orders keep a NULL couponCode and a 0 discount. No rewrite of existing data, no index.
ALTER TABLE "public"."Order" ADD COLUMN     "couponCode" TEXT,
ADD COLUMN     "discount" DOUBLE PRECISION NOT NULL DEFAULT 0;
