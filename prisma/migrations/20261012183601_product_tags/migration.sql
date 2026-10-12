-- AlterTable
ALTER TABLE "public"."Product" ADD COLUMN     "tags" TEXT[] DEFAULT ARRAY[]::TEXT[];
