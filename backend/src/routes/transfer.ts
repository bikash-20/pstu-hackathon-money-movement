import { Router } from "express";
import type { PrismaClient } from "@prisma/client";
import { parse, transferSchema } from "../validate.js";
import { requireIdempotency } from "../middleware.js";
import { assertDailyLimit, bumpDailySpent, fmtBDT, lockUser, notify } from "../money.js";
import { config } from "../config.js";

export function transferRouter(prisma: PrismaClient): Router {
  const r = Router();

  // POST /api/transfer — idempotent P2P send with memo + category.
  r.post("/", requireIdempotency, async (req, res) => {
    const idempotencyKey = req.headers["idempotency-key"] as string;
    const parsed = parse(transferSchema, req.body);
    if (!parsed.ok) {
      res.status(400).json({ error: parsed.error });
      return;
    }
    const { senderId, receiverId, amount, memo, category } = parsed.value;

    if (amount > config.maxTransferCents) {
      res.status(400).json({
        error: `Amount exceeds per-transfer cap of ${fmtBDT(config.maxTransferCents)}. Split it into tranches.`,
      });
      return;
    }

    try {
      const existing = await prisma.transaction.findUnique({ where: { idempotencyKey } });
      if (existing) {
        res.json({ success: true, transactionId: existing.id, message: "Returned cached result" });
        return;
      }

      const result = await prisma.$transaction(async (tx) => {
        const sender = await lockUser(tx, senderId);
        if (!sender) throw new Error("Sender not found");
        if (sender.balance < amount) throw new Error("Insufficient funds");
        const prevSpent = assertDailyLimit(sender, amount);

        const receiver = await tx.user.findUnique({ where: { id: receiverId } });
        if (!receiver) throw new Error("Receiver not found");

        await tx.user.update({ where: { id: senderId }, data: { balance: { decrement: amount } } });
        await bumpDailySpent(tx, senderId, prevSpent, amount);
        await tx.user.update({ where: { id: receiverId }, data: { balance: { increment: amount } } });

        const t = await tx.transaction.create({
          data: { senderId, receiverId, amount, status: "COMPLETED", idempotencyKey, memo: memo ?? null, category },
        });
        await notify(tx, receiverId, "TRANSFER_IN", `Received ${fmtBDT(amount)}`, memo ?? null);
        await notify(tx, senderId, "TRANSFER_OUT", `Sent ${fmtBDT(amount)}`, memo ?? null);
        return t;
      });

      res.json({ success: true, transactionId: result.id });
    } catch (error: unknown) {
      const err = error as { code?: string; message?: string };
      if (err?.code === "P2002") {
        // Concurrent replay slipped past the upfront lookup: balances rolled
        // back atomically, treat as a cached hit instead of an error.
        const existing = await prisma.transaction.findUnique({ where: { idempotencyKey } });
        res.json({ success: true, transactionId: existing?.id, message: "Returned cached result (concurrent replay)" });
        return;
      }
      res.status(400).json({ error: err?.message ?? "Transfer failed" });
    }
  });

  return r;
}
