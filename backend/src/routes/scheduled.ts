import { Router } from "express";
import type { PrismaClient } from "@prisma/client";
import { parse, scheduleSchema } from "../validate.js";
import { fail, requireIdempotency } from "../middleware.js";
import { assertDailyLimit, bumpDailySpent, fmtBDT, lockUser, notify } from "../money.js";

/** Scheduled transfers: intent recorded now (SCHEDULED:<iso> ledger row),
 *  funds move when POST /api/scheduled/settle runs (cron or demo button). */
export function scheduledRouter(prisma: PrismaClient): Router {
  const r = Router();

  r.get("/:userId", async (req, res) => {
    const userId = Number(req.params.userId);
    if (!Number.isInteger(userId) || userId <= 0) {
      fail(res, 400, "Invalid user id");
      return;
    }
    res.json(
      await prisma.transaction.findMany({
        where: { senderId: userId, status: { startsWith: "SCHEDULED:" } },
        orderBy: { id: "desc" },
        take: 20,
        include: { receiver: { select: { id: true, name: true } } },
      })
    );
  });

  r.post("/", requireIdempotency, async (req, res) => {
    const idempotencyKey = req.headers["idempotency-key"] as string;
    const parsed = parse(scheduleSchema, req.body);
    if (!parsed.ok) {
      fail(res, 400, parsed.error);
      return;
    }
    const { senderId, receiverId, amount, memo, category, executeAt } = parsed.value;
    const when = new Date(executeAt);
    if (Number.isNaN(when.getTime()) || when.getTime() <= Date.now()) {
      fail(res, 400, "executeAt must be a future ISO datetime");
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
      await notify(
        prisma as unknown as Parameters<typeof notify>[0],
        senderId, "SYSTEM",
        `Scheduled ${fmtBDT(amount)}`,
        `Settles ${when.toLocaleString("en-BD")}`,
      );
      res.json({ success: true, scheduledId: row.id, executeAt: when.toISOString() });
    } catch (error: unknown) {
      const err = error as { code?: string; message?: string };
      if (err?.code === "P2002") {
        res.json({ success: true, message: "Returned cached result (concurrent replay)" });
        return;
      }
      fail(res, 400, err?.message ?? "Schedule failed");
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
            // Re-check the row inside the transaction so two concurrent
            // settlers don't double-debit the sender. The lockUser FOR UPDATE
            // serialises them.
            const fresh = await tx.transaction.findUnique({ where: { id: row.id } });
            if (!fresh || fresh.status === "COMPLETED") throw new Error("already settled");
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
      fail(res, 500, "Settle failed");
    }
  });

  return r;
}
