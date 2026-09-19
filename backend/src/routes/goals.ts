import { Router } from "express";
import type { PrismaClient } from "@prisma/client";
import { parse, goalDepositSchema, goalSchema } from "../validate.js";
import { fail, requireIdempotency } from "../middleware.js";
import { fmtBDT, lockUser, notify } from "../money.js";

/** Savings goals: spendable balance earmarked into a named jar. A deposit
 *  writes a self-transfer ledger row so the audit trail stays complete. */
export function goalsRouter(prisma: PrismaClient): Router {
  const r = Router();

  r.get("/:userId", async (req, res) => {
    const userId = Number(req.params.userId);
    if (!Number.isInteger(userId) || userId <= 0) {
      fail(res, 400, "Invalid user id");
      return;
    }
    res.json(await prisma.goal.findMany({ where: { userId }, orderBy: { id: "desc" } }));
  });

  r.post("/", async (req, res) => {
    const parsed = parse(goalSchema, req.body);
    if (!parsed.ok) {
      fail(res, 400, parsed.error);
      return;
    }
    const goal = await prisma.goal.create({ data: parsed.value });
    res.json({ success: true, goal });
  });

  r.post("/:id/deposit", requireIdempotency, async (req, res) => {
    const goalId = Number(req.params.id);
    const idempotencyKey = req.headers["idempotency-key"] as string;
    const parsed = parse(goalDepositSchema, req.body);
    if (!parsed.ok || !Number.isInteger(goalId) || goalId <= 0) {
      fail(res, 400, parsed.ok ? "Invalid goal id" : parsed.error);
      return;
    }
    try {
      const existing = await prisma.transaction.findUnique({ where: { idempotencyKey } });
      if (existing) {
        res.json({ success: true, message: "Returned cached result" });
        return;
      }
      const goal = await prisma.$transaction(async (tx) => {
        const user = await lockUser(tx, parsed.value.userId);
        if (!user) throw new Error("User not found");
        if (user.balance < parsed.value.amount) throw new Error("Insufficient funds");
        const g = await tx.goal.findFirst({ where: { id: goalId, userId: parsed.value.userId } });
        if (!g) throw new Error("Goal not found");
        if (g.completedAt) throw new Error("Goal already completed");
        await tx.user.update({ where: { id: user.id }, data: { balance: { decrement: parsed.value.amount } } });
        const saved = g.savedAmount + parsed.value.amount;
        const done = saved >= g.targetAmount;
        const updated = await tx.goal.update({
          where: { id: goalId },
          data: { savedAmount: saved, completedAt: done ? new Date() : null },
        });
        await tx.transaction.create({
          data: {
            senderId: user.id, receiverId: user.id,
            amount: parsed.value.amount, status: "COMPLETED",
            idempotencyKey, memo: `Goal deposit: ${g.name}`, category: "SAVINGS",
          },
        });
        if (done) await notify(tx, user.id, "GOAL_DONE", `Goal reached: ${g.name}`, fmtBDT(g.targetAmount));
        return updated;
      });
      res.json({ success: true, goal });
    } catch (error: unknown) {
      const err = error as { code?: string; message?: string };
      if (err?.code === "P2002") {
        res.json({ success: true, message: "Returned cached result (concurrent replay)" });
        return;
      }
      fail(res, 400, err?.message ?? "Deposit failed");
    }
  });

  return r;
}
