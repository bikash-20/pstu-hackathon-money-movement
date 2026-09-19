import { Router } from "express";
import type { PrismaClient } from "@prisma/client";
import { parse, scheduleSchema } from "../validate.js";
import { requireIdempotency } from "../middleware.js";
import { assertDailyLimit, bumpDailySpent, fmtBDT, lockUser, notify } from "../money.js";

/** Scheduled transfers: intent recorded now (SCHEDULED:<iso> ledger row),
 *  funds move when POST /api/scheduled/settle runs (cron or demo button). */
export function scheduledRouter(prisma: PrismaClient): Router {
  const r = Router();

  r.post("/", requireIdempotency, async (req, res) => {
    const idempotencyKey = req.headers["idempotency-key"] as string;
    const parsed = parse(scheduleSchema, req.body);
    if (!parsed.ok) {
      res.status(400).json({ error: parsed.error });
      return;
    }
    const { senderId, receiverId, amount, memo, category, executeAt } = parsed.value;
    const when = new Date(executeAt);
    if (Number.isNaN(when.getTime()) || when.getTime() <= Date.now()) {
      res.status(400).json({ error: "executeAt must be a future ISO datetime" });
      return;
    }
    try {
      const existing = await prisma.transaction.findUnique({ where: { idempotencyKey } });
      if (existing) {
        res.json({ success: true, scheduledId: existing.id, message: "Returned cached result" });
        return;
      }
      const row = await prisma.transaction.create({
        data: {
          senderId, receiverId, amount, memo: memo ?? null, category,
          status: `SCHEDULED:${when.toISOString()}`,
          idempotencyKey,
        },
      });
      await prisma.notification.create({
        data: {
          userId: senderId, kind: "SYSTEM",
          title: `Scheduled ${fmtBDT(amount)}`,
          body: `Settles ${when.toLocaleString("en-BD")}`,
        },
      });
      res.json({ success: true, scheduledId: row.id, executeAt: when.toISOString() });
    } catch (error: unknown) {
      const err = error as { code?: string; message?: string };
      if (err?.code === "P2002") {
        res.json({ success: true, message: "Returned cached result (concurrent replay)" });
        return;
      }
      res.status(400).json({ error: err?.message ?? "Schedule failed" });
    }
  });

  r.post("/settle", async (_req, res) => {
    try {
      const due = await prisma.transaction.findMany({
        where: { status: { startsWith: "SCHEDULED:" } },
        orderBy: { id: "asc" },
        take: 50,
      });
      let settled = 0;
      let skipped = 0;
      for (const row of due) {
        const when = new Date(row.status.slice("SCHEDULED:".length));
        if (Number.isNaN(when.getTime()) || when.getTime() > Date.now()) {
          skipped++;
          continue;
        }
        try {
          await prisma.$transaction(async (tx) => {
            const sender = await lockUser(tx, row.senderId);
            if (!sender) throw new Error("Sender not found");
            if (sender.balance < row.amount) throw new Error("Insufficient funds");
            const prevSpent = assertDailyLimit(sender, row.amount);
            await tx.user.update({ where: { id: row.senderId }, data: { balance: { decrement: row.amount } } });
            await bumpDailySpent(tx, row.senderId, prevSpent, row.amount);
            await tx.user.update({ where: { id: row.receiverId }, data: { balance: { increment: row.amount } } });
            await tx.transaction.update({ where: { id: row.id }, data: { status: "COMPLETED" } });
            await notify(tx, row.receiverId, "TRANSFER_IN", `Scheduled payment received: ${fmtBDT(row.amount)}`);
          });
          settled++;
        } catch {
          skipped++;
        }
      }
      res.json({ success: true, settled, skipped });
    } catch {
      res.status(500).json({ error: "Settle failed" });
    }
  });

  return r;
}
