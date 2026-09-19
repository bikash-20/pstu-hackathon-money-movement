import { Router } from "express";
import type { PrismaClient } from "@prisma/client";
import { parse, merchantPaySchema } from "../validate.js";
import { fail, requireIdempotency } from "../middleware.js";
import { config } from "../config.js";
import { assertDailyLimit, bumpDailySpent, fmtBDT, lockUser, notify } from "../money.js";

/**
 * Merchant checkout. The user pays a merchant by code (e.g. "DARAZ",
 * "FLIPCART", "DPDC"); the merchant lives in the seeded Merchant table.
 * Money leaves the wallet (debit) and the off-wallet sink is the External
 * user (id 0). The Transaction row carries `category: MERCHANT` and
 * `merchantCode` so the activity feed renders the merchant name on read.
 *
 * Daily spend limit applies (it's a debit). For real production this is
 * where the Daraz / SSLCommerz / bKash payment-gateway call would be made
 * before the local debit; here we credit the off-wallet sink only.
 */
export function merchantRouter(prisma: PrismaClient): Router {
  const r = Router();

  /** GET /api/merchant — list all merchant directories the user can pay. */
  r.get("/", async (_req, res) => {
    try {
      const rows = await prisma.merchant.findMany({ orderBy: { name: "asc" } });
      res.json({ success: true, merchants: rows });
    } catch {
      fail(res, 500, "Failed to fetch merchants");
    }
  });

  /** GET /api/merchant/:code — one merchant detail by short code. */
  r.get("/:code", async (req, res) => {
    const code = String(req.params.code || "").trim();
    if (code.length < 2) { fail(res, 400, "Invalid merchant code"); return; }
    const m = await prisma.merchant.findUnique({ where: { code } });
    if (!m) { fail(res, 404, "Merchant not found"); return; }
    res.json({ success: true, merchant: m });
  });

  /** POST /api/merchant/pay — debit user, credit External(0), tag the merchant. */
  r.post("/pay", requireIdempotency, async (req, res) => {
    const idempotencyKey = req.headers["idempotency-key"] as string;
    const parsed = parse(merchantPaySchema, req.body);
    if (!parsed.ok) { fail(res, 400, parsed.error); return; }
    const { userId, merchantCode, amount, orderRef, memo: rawMemo } = parsed.value;

    if (amount > config.maxTransferCents) {
      fail(res, 400, `Amount exceeds per-transfer cap of ${fmtBDT(config.maxTransferCents)}`);
      return;
    }

    const merchant = await prisma.merchant.findUnique({ where: { code: merchantCode } });
    if (!merchant) { fail(res, 404, "Merchant not found"); return; }

    const memo = rawMemo ?? `${merchant.name}${orderRef ? ` · Order ${orderRef}` : ""}`;

    try {
      const existing = await prisma.transaction.findUnique({ where: { idempotencyKey } });
      if (existing) {
        res.json({ success: true, transactionId: existing.id, message: "Returned cached result" });
        return;
      }
      const result = await prisma.$transaction(async (tx) => {
        const user = await lockUser(tx, userId);
        if (!user) throw new Error("User not found");
        if (user.balance < amount) throw new Error("Insufficient funds");
        const prevSpent = assertDailyLimit(user, amount);

        await tx.user.update({ where: { id: userId }, data: { balance: { decrement: amount } } });
        await bumpDailySpent(tx, userId, prevSpent, amount);
        await tx.user.update({
          where: { id: 0 },
          data: { balance: { increment: amount } },
        }).catch(() => { /* no-op if External row absent */ });

        const t = await tx.transaction.create({
          data: {
            senderId: userId,
            receiverId: 0,
            amount,
            status: "COMPLETED",
            idempotencyKey,
            memo,
            category: "MERCHANT",
            merchantCode: merchant.code,
          },
        });
        await notify(tx, userId, "MERCHANT_OUT", `Paid ${fmtBDT(amount)} to ${merchant.name}`, memo);
        return t;
      });
      res.json({ success: true, transactionId: result.id, merchant: { code: merchant.code, name: merchant.name } });
    } catch (error: unknown) {
      const err = error as { code?: string; message?: string };
      if (err?.code === "P2002") {
        const existing = await prisma.transaction.findUnique({ where: { idempotencyKey } });
        res.json({ success: true, transactionId: existing?.id, message: "Returned cached result (concurrent replay)" });
        return;
      }
      fail(res, 400, err?.message ?? "Merchant payment failed");
    }
  });

  return r;
}
