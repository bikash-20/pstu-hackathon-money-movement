import { Router } from "express";
import type { PrismaClient } from "@prisma/client";
import { parse, splitSchema } from "../validate.js";
import { fail, requireIdempotency } from "../middleware.js";
import { assertDailyLimit, bumpDailySpent, fmtBDT, lockUser, notify } from "../money.js";

export function splitRouter(prisma: PrismaClient): Router {
  const r = Router();

  // POST /api/split — atomic even split across N recipients.
  r.post("/", requireIdempotency, async (req, res) => {
    const idempotencyKey = req.headers["idempotency-key"] as string;
    const parsed = parse(splitSchema, req.body);
    if (!parsed.ok) {
      fail(res, 400, parsed.error);
      return;
    }
    const { initiatorId, recipientIds, totalAmount, memo, category } = parsed.value;

    const unique = Array.from(new Set(recipientIds));
    if (unique.length !== recipientIds.length) {
      fail(res, 400, "recipientIds contains duplicates");
      return;
    }

    // Split uses N+1 idempotency keys (one per leg + the initiator-debit).
    // Replay detection only needs the first leg's key — if that exists, the
    // whole split already landed atomically inside the same $transaction.
    const replayKey = `${idempotencyKey}:leg:0`;
    try {
      const existing = await prisma.transaction.findUnique({ where: { idempotencyKey: replayKey } });
      if (existing) {
        res.json({ success: true, splitTransactionIds: [existing.id], message: "Returned cached result" });
        return;
      }
    } catch { /* fall through to the write attempt */ }

    try {
      const created = await prisma.$transaction(async (tx) => {
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
        const ids: { id: number }[] = [];
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
          ids.push({ id: t.id });
        }
        return ids;
      });

      res.json({ success: true, splitTransactionIds: created.map((t) => t.id), recipientCount: unique.length });
    } catch (error: unknown) {
      const err = error as { code?: string; message?: string };
      if (err?.code === "P2002") {
        // Concurrent replay: another worker landed the legs after our pre-check.
        // Return the first leg's id so the caller can dedupe.
        const existing = await prisma.transaction.findUnique({ where: { idempotencyKey: replayKey } });
        res.json({ success: true, splitTransactionIds: existing ? [existing.id] : [], message: "Returned cached result (concurrent replay)" });
        return;
      }
      fail(res, 400, err?.message ?? "Split failed");
    }
  });

  return r;
}
