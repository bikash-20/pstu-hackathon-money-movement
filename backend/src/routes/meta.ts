import { Router } from "express";
import type { PrismaClient } from "@prisma/client";
import { fail } from "../middleware.js";

/** Spending insights + notification inbox + read APIs. */
export function metaRouter(prisma: PrismaClient): Router {
  const r = Router();

  r.get("/insights/:userId", async (req, res) => {
    const userId = Number(req.params.userId);
    if (!Number.isInteger(userId) || userId <= 0) {
      fail(res, 400, "Invalid user id");
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
      fail(res, 400, "Invalid user id");
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
      fail(res, 400, "Invalid notification id");
      return;
    }
    await prisma.notification.updateMany({ where: { id }, data: { read: true } });
    res.json({ success: true });
  });

  r.post("/notifications/:userId/read-all", async (req, res) => {
    const userId = Number(req.params.userId);
    if (!Number.isInteger(userId) || userId <= 0) {
      fail(res, 400, "Invalid user id");
      return;
    }
    await prisma.notification.updateMany({ where: { userId, read: false }, data: { read: true } });
    res.json({ success: true });
  });

  /**
   * GET /api/festivals/upcoming
   *
   * Static 2026 Bangladeshi festival calendar (Eid, Durga Puja, Pohela
   * Boishakh, etc.). The frontend renders a "Schedule festival bonus"
   * strip when a festival is within 14 days. The dates here are
   * representative for the demo; production would re-fetch from an
   * authoritative lunar-calendar source.
   */
  r.get("/festivals/upcoming", async (req, res) => {
    const windowDays = Math.min(Math.max(Number(req.query.days ?? 30), 1), 365);
    const today = new Date();
    const horizon = new Date(today.getTime() + windowDays * 86_400_000);
    const festivals = [
      { key: "POHELA_BOISHAKH", name: "Pohela Boishakh (Bengali New Year)", date: "2026-04-14" },
      { key: "EID",             name: "Eid-ul-Fitr",                        date: "2026-03-20" },
      { key: "EID",             name: "Eid-ul-Adha",                        date: "2026-05-27" },
      { key: "INDEPENDENCE",    name: "Independence Day",                   date: "2026-03-26" },
      { key: "VICTORY",         name: "Victory Day",                        date: "2026-12-16" },
      { key: "DURGA_PUJA",      name: "Durga Puja",                         date: "2026-10-18" },
    ];
    const upcoming = festivals
      .map((f) => {
        const d = new Date(`${f.date}T00:00:00`);
        const daysAway = Math.ceil((d.getTime() - today.getTime()) / 86_400_000);
        return { ...f, dateObj: d.toISOString(), daysAway };
      })
      .filter((f) => {
        const t = new Date(f.dateObj).getTime();
        return t >= today.getTime() && t <= horizon.getTime();
      })
      .sort((a, b) => new Date(a.dateObj).getTime() - new Date(b.dateObj).getTime());
    res.json({ success: true, today: today.toISOString(), windowDays, festivals: upcoming });
  });

  return r;
}
