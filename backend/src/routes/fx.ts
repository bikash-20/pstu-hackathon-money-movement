import { Router } from "express";
import type { PrismaClient } from "@prisma/client";
import { parse, fxTransferSchema } from "../validate.js";
import { fail, requireIdempotency } from "../middleware.js";
import { config, FX_CURRENCIES, type FxCurrency } from "../config.js";
import { assertDailyLimit, bumpDailySpent, fmtBDT, lockUser, notify } from "../money.js";

/**
 * FX / multi-currency transfer.
 *
 * Wallet always settles in BDT, but a sender can fund in a foreign currency.
 * The server multiplies `amountForeign × rate` to get the BDT-equivalent in
 * cents, then debits the sender's BDT balance (with full daily-limit check)
 * and credits the receiver in BDT. The Transaction row carries the foreign
 * amount + currency in `memo` and `currency` so the audit trail can show
 * "FX: 10 USD → ৳1,100.00" without losing the source currency.
 *
 * Rate table is env-overridable (`FX_USD_BDT=…`) so a production deploy
 * can wire a live FX feed by reading the env-var factory at boot.
 */
function rateFor(currency: FxCurrency): number {
  return config.fxRates[currency];
}

export function fxRouter(prisma: PrismaClient): Router {
  const r = Router();

  /** GET /api/fx/rates — server-controlled rate table. */
  r.get("/rates", (_req, res) => {
    const rates = Object.fromEntries(
      FX_CURRENCIES.map((c) => [c, rateFor(c)]),
    );
    res.json({ success: true, base: "BDT", rates });
  });

  /** POST /api/fx/transfer — convert + send in BDT. */
  r.post("/transfer", requireIdempotency, async (req, res) => {
    const idempotencyKey = req.headers["idempotency-key"] as string;
    const parsed = parse(fxTransferSchema, req.body);
    if (!parsed.ok) { fail(res, 400, parsed.error); return; }
    const { senderId, receiverId, amountForeign, currency, category, memo: rawMemo } = parsed.value;

    if (senderId === receiverId) { fail(res, 400, "Cannot FX-transfer to yourself"); return; }

    const rate = rateFor(currency);
    // `amountForeign` is in major units (e.g. $10 = 10.00). Multiply by the
    // rate (per-1-unit BDT value) and round to integer cents.
    const bdtCents = Math.round(amountForeign * rate * 100);

    if (bdtCents <= 0) { fail(res, 400, "Computed BDT amount must be positive"); return; }
    if (bdtCents > config.maxTransferCents) {
      fail(res, 400, `Computed BDT exceeds per-transfer cap of ${fmtBDT(config.maxTransferCents)}`);
      return;
    }

    const receiver = await prisma.user.findUnique({ where: { id: receiverId } });
    if (!receiver) { fail(res, 400, "Receiver not found"); return; }

    const memo = rawMemo ?? `FX: ${amountForeign} ${currency} → ${fmtBDT(bdtCents)}`;

    try {
      const existing = await prisma.transaction.findUnique({ where: { idempotencyKey } });
      if (existing) {
        res.json({
          success: true,
          transactionId: existing.id,
          bdtAmount: existing.amount,
          rate,
          message: "Returned cached result",
        });
        return;
      }
      const result = await prisma.$transaction(async (tx) => {
        const sender = await lockUser(tx, senderId);
        if (!sender) throw new Error("Sender not found");
        if (sender.balance < bdtCents) throw new Error("Insufficient funds");
        const prevSpent = assertDailyLimit(sender, bdtCents);

        await tx.user.update({ where: { id: senderId }, data: { balance: { decrement: bdtCents } } });
        await bumpDailySpent(tx, senderId, prevSpent, bdtCents);
        await tx.user.update({ where: { id: receiverId }, data: { balance: { increment: bdtCents } } });

        const t = await tx.transaction.create({
          data: {
            senderId,
            receiverId,
            amount: bdtCents,
            status: "COMPLETED",
            idempotencyKey,
            memo,
            category,
            currency,
          },
        });
        await notify(
          tx, receiverId, "FX_IN",
          `FX received: ${fmtBDT(bdtCents)} (${amountForeign} ${currency})`,
          memo,
        );
        await notify(
          tx, senderId, "FX_OUT",
          `FX sent: ${fmtBDT(bdtCents)} (${amountForeign} ${currency})`,
          memo,
        );
        return t;
      });
      res.json({
        success: true,
        transactionId: result.id,
        bdtAmount: result.amount,
        rate,
      });
    } catch (error: unknown) {
      const err = error as { code?: string; message?: string };
      if (err?.code === "P2002") {
        const existing = await prisma.transaction.findUnique({ where: { idempotencyKey } });
        res.json({
          success: true,
          transactionId: existing?.id,
          bdtAmount: existing?.amount,
          rate,
          message: "Returned cached result (concurrent replay)",
        });
        return;
      }
      fail(res, 400, err?.message ?? "FX transfer failed");
    }
  });

  return r;
}
