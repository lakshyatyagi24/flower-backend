-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('CUSTOMER', 'ADMIN');

-- AlterTable Product: add new commerce fields
ALTER TABLE "Product"
  ADD COLUMN "image" TEXT,
  ADD COLUMN "stock" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "featured" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "active" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable User: add role
ALTER TABLE "User"
  ADD COLUMN "role" "UserRole" NOT NULL DEFAULT 'CUSTOMER';

-- AlterTable Order: add commerce fields
ALTER TABLE "Order"
  ADD COLUMN "subtotal" DOUBLE PRECISION NOT NULL DEFAULT 0,
  ADD COLUMN "shipping" DOUBLE PRECISION NOT NULL DEFAULT 0,
  ADD COLUMN "paymentMethod" TEXT NOT NULL DEFAULT 'COD',
  ADD COLUMN "customerName" TEXT,
  ADD COLUMN "customerEmail" TEXT,
  ADD COLUMN "customerPhone" TEXT,
  ADD COLUMN "shippingAddress" TEXT,
  ADD COLUMN "city" TEXT,
  ADD COLUMN "postalCode" TEXT,
  ADD COLUMN "notes" TEXT;

-- AlterTable OrderItem: add productName
ALTER TABLE "OrderItem"
  ADD COLUMN "productName" TEXT NOT NULL DEFAULT '';

-- CreateTable Setting
CREATE TABLE "Setting" (
  "id" SERIAL NOT NULL,
  "key" TEXT NOT NULL,
  "value" TEXT NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Setting_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Setting_key_key" ON "Setting"("key");
