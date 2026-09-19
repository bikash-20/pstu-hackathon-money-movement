-- Replace the timestamp-based daily window with an explicit settlement-day key.
--
-- Why: `dailySpentAt` was compared against `now()` in application code, and the
-- counter was flushed with raw `$executeRaw`, which binds a JS Date as *local*
-- wall-clock while Prisma's typed client writes UTC into `timestamp(3)`.
-- The two encodings disagreed by the server's UTC offset, so a freshly written
-- window could read back as "not today" and silently reset the daily spend
-- tally on every transfer.
--
-- A "YYYY-MM-DD" string in the wallet's business timezone (Asia/Dhaka) is
-- compared with plain equality, so no offset arithmetic can go wrong. The old
-- counter is carried over inside its own (now stale) window key, which the
-- application treats as a fresh day — the safe direction for a spend cap.

ALTER TABLE "User" ADD COLUMN "dailyWindow" TEXT NOT NULL DEFAULT '';

UPDATE "User"
SET "dailyWindow" = to_char("dailySpentAt" AT TIME ZONE 'UTC', 'YYYY-MM-DD')
WHERE "dailySpentAt" IS NOT NULL;

ALTER TABLE "User" DROP COLUMN "dailySpentAt";
