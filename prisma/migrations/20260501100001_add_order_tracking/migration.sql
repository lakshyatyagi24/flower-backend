-- AddField: order tracking + admin notes
ALTER TABLE "Order" ADD COLUMN "trackingNumber" TEXT;
ALTER TABLE "Order" ADD COLUMN "courierName" TEXT;
ALTER TABLE "Order" ADD COLUMN "adminNotes" TEXT;
