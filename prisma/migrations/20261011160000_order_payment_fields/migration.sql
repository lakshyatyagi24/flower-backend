-- CreateEnum
CREATE TYPE "public"."PaymentStatus" AS ENUM ('UNPAID', 'PAID', 'FAILED', 'REFUNDED');

-- AlterTable
ALTER TABLE "public"."Order" ADD COLUMN     "paidAt" TIMESTAMP(3),
ADD COLUMN     "paymentStatus" "public"."PaymentStatus" NOT NULL DEFAULT 'UNPAID',
ADD COLUMN     "razorpayOrderId" TEXT,
ADD COLUMN     "razorpayPaymentId" TEXT,
ADD COLUMN     "refundNote" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Order_razorpayOrderId_key" ON "public"."Order"("razorpayOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "Order_razorpayPaymentId_key" ON "public"."Order"("razorpayPaymentId");

