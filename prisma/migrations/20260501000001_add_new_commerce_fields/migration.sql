-- CreateEnum: ProductType
CREATE TYPE "ProductType" AS ENUM ('CUT_FLOWER', 'PLANT', 'BOUQUET', 'ARRANGEMENT', 'HAMPER');

-- CreateEnum: SaleMode
CREATE TYPE "SaleMode" AS ENUM ('PURCHASE', 'ENQUIRY');

-- CreateEnum: EnquiryStatus
CREATE TYPE "EnquiryStatus" AS ENUM ('NEW', 'CONTACTED', 'QUOTED', 'CONVERTED', 'CLOSED');

-- AlterTable Category: add new fields
ALTER TABLE "Category"
  ADD COLUMN "description"     TEXT,
  ADD COLUMN "productType"     "ProductType" NOT NULL DEFAULT 'CUT_FLOWER',
  ADD COLUMN "defaultSaleMode" "SaleMode"    NOT NULL DEFAULT 'PURCHASE',
  ADD COLUMN "defaultGstRate"  DOUBLE PRECISION NOT NULL DEFAULT 0,
  ADD COLUMN "sortOrder"       INTEGER      NOT NULL DEFAULT 0,
  ADD COLUMN "active"          BOOLEAN      NOT NULL DEFAULT true;

-- AlterTable Product: add new fields
ALTER TABLE "Product"
  ADD COLUMN "productType" "ProductType" NOT NULL DEFAULT 'CUT_FLOWER',
  ADD COLUMN "saleMode"    "SaleMode"    NOT NULL DEFAULT 'PURCHASE',
  ADD COLUMN "gstRate"     DOUBLE PRECISION NOT NULL DEFAULT 0,
  ADD COLUMN "unit"        TEXT         NOT NULL DEFAULT 'piece',
  ADD COLUMN "minOrderQty" INTEGER      NOT NULL DEFAULT 1;

-- AlterTable Order: add gst field
ALTER TABLE "Order"
  ADD COLUMN "gst" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- AlterTable OrderItem: add GST fields
ALTER TABLE "OrderItem"
  ADD COLUMN "gstRate"   DOUBLE PRECISION NOT NULL DEFAULT 0,
  ADD COLUMN "gstAmount" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- CreateTable Enquiry
CREATE TABLE "Enquiry" (
  "id"            SERIAL NOT NULL,
  "userId"        INTEGER,
  "productId"     INTEGER,
  "productName"   TEXT,
  "customerName"  TEXT NOT NULL,
  "customerEmail" TEXT,
  "customerPhone" TEXT NOT NULL,
  "quantity"      INTEGER,
  "eventDate"     TIMESTAMP(3),
  "occasion"      TEXT,
  "budget"        DOUBLE PRECISION,
  "address"       TEXT,
  "city"          TEXT,
  "message"       TEXT,
  "source"        TEXT NOT NULL DEFAULT 'website',
  "status"        "EnquiryStatus" NOT NULL DEFAULT 'NEW',
  "adminNotes"    TEXT,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Enquiry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Enquiry_status_createdAt_idx" ON "Enquiry"("status", "createdAt");

-- AddForeignKey
ALTER TABLE "Enquiry"
  ADD CONSTRAINT "Enquiry_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Enquiry"
  ADD CONSTRAINT "Enquiry_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "Product"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
