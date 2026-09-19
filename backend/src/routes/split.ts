import { Router } from "express";
import type { PrismaClient } from "@prisma/client";
import { parse, splitSchema } from "../validate.js";
import { requireIdempotency } from "../middleware.js";
import { assertDailyLimit, bumpDailySpent, fmtBDT, lockUser, notify } from "../money.js";

export function splitRouter(prisma: PrismaClient): Router {
  const r = Router();

  // POST /api/split — atomic even split across N recipients.
  r.post("/", requireIdempotency, async (req, res) => {
    const idempotencyKey = req.headers["idempotency-key"] as string;
    const parsed = parse(splitSchema, req.body);
    if (!parsed.ok) {
      res.status(400).json({ error: parsed.error });
      return;
    }
    const { initiatorId, recipientIds, totalAmount, memo, category } = parsed.value;

    const unique = Array.from(new Set(recipientIds));
    if (unique.length !== recipientIds.length) {
      res.status(400).json({ error: "recipientIds contains duplicates" });
      return;
    }

    try {
      const existing = await prisma.transaction.findUnique({
        where: { idempotencyKey: `${idempotencyKey}:leg:0` },
      });
      if (existing) {
        res.json({ success: true, splitTransactionIds: [existing.id], message: "Returned cached result" });
        return;
      }

      const result = await prisma.$transaction(async (tx) => {
        const initiator = await lockUser(tx, initiatorId);
        if (!initiator) throw new Error("Initiator not found");
        if (initiator.balance < totalAmount) throw new Error("Insufficient funds for full split");
        const prevSpent = assertDailyLimit(initiator, totalAmount);

        const recipients = await tx.user.findMany({
          where: { id: { in: unique } },
          select: { id: true },
        });
        if (recipients.length !== unique.length) throw new Error("One or more recipients not found");

        await tx.user.update({ where: { id: initiatorId }, data: { balance: { decrement: totalAmount } } });
        await bumpDailySpent(tx, initiatorId, prevSpent, totalAmount);

        const share = Math.floor(totalAmount / unique.length);
        const remainder = totalAmount - share * unique.length;
        const created: { id: number }[] = [];
        for (let i = 0; i < unique.length; i++) {
          const recipientId = unique[i] as number;
          const legAmount = share + (i === 0 ? remainder : 0);
          await tx.user.update({ where: { id: recipientId }, data: { balance: { increment: legAmount } } });
          const t = await tx.transaction.create({
            data: {
              senderId: initiatorId,
              receiverId: recipientId,
              amount: legAmount,
              status: "COMPLETED",
              idempotencyKey: `${idempotencyKey}:leg:${i}`,
              memo: memo ?? null,
              category,
            },
          });
          await notify(tx, recipientId, "SPLIT_IN", `Split received: ${fmtBDT(legAmount)}`, memo ?? null);
          created.push({ id: t.id });
        }
        return created;
      });

      res.json({ success: true, splitTransactionIds: result.map((t) => t.id), recipientCount: unique.length });
    } catch (error: unknown) {
      const err = error as { code?: string; message?: string };
      if (err?.code === "P2002") {
        res.json({ success: true, splitTransactionIds: [], message: "Returned cached result (concurrent replay)" });
        return;
      }
      res.status(400).json({ error: err?.message ?? "Split failed" });
    }
  });

  return r;
}
