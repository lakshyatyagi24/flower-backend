-- CreateTable
CREATE TABLE "public"."Slider" (
    "id" SERIAL NOT NULL,
    "title" TEXT,
    "eyebrow" TEXT,
    "subtitle" TEXT,
    "alt" TEXT,
    "image" TEXT,
    "href" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Slider_pkey" PRIMARY KEY ("id")
);
