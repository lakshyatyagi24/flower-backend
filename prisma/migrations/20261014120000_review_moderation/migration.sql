-- Review moderation. Additive and safe on a live DB.
CREATE TYPE "ReviewStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- Adding the column with an APPROVED default backfills every existing row as APPROVED
-- (reviews that were already public stay public) ...
ALTER TABLE "Review" ADD COLUMN "status" "ReviewStatus" NOT NULL DEFAULT 'APPROVED';
UPDATE "Review" SET "status" = 'APPROVED';
-- ... then new rows default to PENDING.
ALTER TABLE "Review" ALTER COLUMN "status" SET DEFAULT 'PENDING';

CREATE INDEX "Review_productId_status_idx" ON "Review"("productId", "status");
