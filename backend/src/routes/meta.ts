import { Router } from "express";
import type { PrismaClient } from "@prisma/client";

/** Spending insights + notification inbox + read APIs. */
export function metaRouter(prisma: PrismaClient): Router {
  const r = Router();

  r.get("/insights/:userId", async (req, res) => {
    const userId = Number(req.params.userId);
    if (!Number.isInteger(userId) || userId <= 0) {
      res.status(400).json({ error: "Invalid user id" });
      return;
    }
    const days = Math.min(Math.max(Number(req.query.days ?? 30), 1), 365);
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const rows = await prisma.transaction.findMany({
      where: { senderId: userId, status: "COMPLETED", createdAt: { gte: since } },
      select: { amount: true, category: true },
    });
    const byCategory: Record<string, { total: number; count: number }> = {};
    let totalOut = 0;
    for (const t of rows) {
      totalOut += t.amount;
      const c = byCategory[t.category] ?? { total: 0, count: 0 };
      c.total += t.amount;
      c.count += 1;
      byCategory[t.category] = c;
    }
    const breakdown = Object.entries(byCategory)
      .map(([category, v]) => ({ category, ...v, pct: totalOut ? Math.round((v.total / totalOut) * 100) : 0 }))
      .sort((a, b) => b.total - a.total);
    res.json({ userId, days, totalOut, count: rows.length, breakdown });
  });

  r.get("/notifications/:userId", async (req, res) => {
    const userId = Number(req.params.userId);
    if (!Number.isInteger(userId) || userId <= 0) {
      res.status(400).json({ error: "Invalid user id" });
      return;
    }
    const unreadOnly = req.query.unread === "1";
    res.json(
      await prisma.notification.findMany({
        where: unreadOnly ? { userId, read: false } : { userId },
        orderBy: { id: "desc" },
        take: 50,
      })
    );
  });

  r.post("/notifications/:id/read", async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ error: "Invalid notification id" });
      return;
    }
    await prisma.notification.updateMany({ where: { id }, data: { read: true } });
    res.json({ success: true });
  });

  r.post("/notifications/:userId/read-all", async (req, res) => {
    const userId = Number(req.params.userId);
    if (!Number.isInteger(userId) || userId <= 0) {
      res.status(400).json({ error: "Invalid user id" });
      return;
    }
    await prisma.notification.updateMany({ where: { userId, read: false }, data: { read: true } });
    res.json({ success: true });
  });

  return r;
}
