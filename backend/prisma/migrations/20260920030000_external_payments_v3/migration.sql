-- External Payments v3
--
-- Adds the data surface for off-wallet flows:
--   • Funding (add money from bKash/Nagad/Rocket/Bank/Card, cash out to the same)
--   • Merchant checkout (Daraz/Flipkart/Foodpanda/DPDC/etc.)
--   • Recurring / standing instructions (rent, salary, EMI)
--   • Refunds (reverses an existing Transaction atomically)
--   • FX / multi-currency (sends BDT equivalent after conversion)
--   • Festival bill pay (Eid / Durga Puja / Pohela Boishakh tagging)
--
-- All flows reuse the existing Transaction ledger. The "External" user with
-- id=0 (seeded by /api/seed and /api/admin/reset) is the off-wallet counterparty
-- so we never need a separate ledger table.

-- ─── Transaction column additions ────────────────────────────────────────────
ALTER TABLE "Transaction"
  ADD COLUMN "currency"     TEXT NOT NULL DEFAULT 'BDT',
  ADD COLUMN "merchantCode" TEXT,
  ADD COLUMN "festivalTag"  TEXT;

CREATE INDEX "Transaction_status_idx"       ON "Transaction"("status");
CREATE INDEX "Transaction_merchantCode_idx" ON "Transaction"("merchantCode");

-- ─── Merchant directory ───────────────────────────────────────────────────────
CREATE TABLE "Merchant" (
    "id"          SERIAL          NOT NULL,
    "code"        TEXT            NOT NULL,
    "name"        TEXT            NOT NULL,
    "category"    TEXT            NOT NULL,
    "mfsProvider" TEXT,
    "createdAt"   TIMESTAMP(3)    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Merchant_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Merchant_code_key" ON "Merchant"("code");

-- ─── Standing instructions ────────────────────────────────────────────────────
CREATE TABLE "RecurringInstruction" (
    "id"          SERIAL          NOT NULL,
    "userId"      INTEGER         NOT NULL,
    "recipientId" INTEGER         NOT NULL,
    "amount"      INTEGER         NOT NULL,
    "cadence"     TEXT            NOT NULL,
    "startAt"     TIMESTAMP(3)    NOT NULL,
    "nextRunAt"   TIMESTAMP(3)    NOT NULL,
    "active"      BOOLEAN         NOT NULL DEFAULT true,
    "memo"        TEXT,
    "category"    TEXT            NOT NULL DEFAULT 'TRANSFER',
    "createdAt"   TIMESTAMP(3)    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RecurringInstruction_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "RecurringInstruction_userId_active_idx"
  ON "RecurringInstruction"("userId", "active");
CREATE INDEX "RecurringInstruction_nextRunAt_active_idx"
  ON "RecurringInstruction"("nextRunAt", "active");

ALTER TABLE "RecurringInstruction"
  ADD CONSTRAINT "RecurringInstruction_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RecurringInstruction"
  ADD CONSTRAINT "RecurringInstruction_recipientId_fkey"
  FOREIGN KEY ("recipientId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
