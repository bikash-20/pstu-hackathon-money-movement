-- AlterTable
ALTER TABLE "User" ADD COLUMN "phone" TEXT;

-- Backfill the 3 seed/reset users with realistic BD mobile numbers.
-- Format: "+880 1XXX-XXXXXX". Prefixes chosen from real Bangladeshi
-- mobile operators (017 = Grameenphone, 018 = Robi, 019 = Banglalink).
UPDATE "User" SET "phone" = '+880 1712-345678' WHERE "name" = 'Alice';
UPDATE "User" SET "phone" = '+880 1823-456789' WHERE "name" = 'Bob';
UPDATE "User" SET "phone" = '+880 1934-567890' WHERE "name" = 'Charlie';