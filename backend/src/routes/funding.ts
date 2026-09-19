import { Router } from "express";
import type { PrismaClient } from "@prisma/client";
import { parse, fundingAddSchema, fundingWithdrawSchema } from "../validate.js";
import { fail, requireIdempotency } from "../middleware.js";
import { config, FUNDING_PROVIDERS } from "../config.js";
import { assertDailyLimit, bumpDailySpent, fmtBDT, lockUser, notify, dayKey } from "../money.js";

/**
 * External payment rails (Add Money / Cash Out).
 *
 * The user-facing counterparty is always the seeded "External" user (id 0).
 * We never move money into or out of that user's *balance* in a meaningful
 * way — it's a row in the audit ledger, not a wallet. This lets us reuse
 * the existing Transaction table + pessimistic-lock plumbing without
 * inventing a separate "external account" model.
 *
 * `/add`  — credit user from External (no daily-limit, has funding cap).
 * `/withdraw` — debit user to External (full daily-limit applies).
 *
 * Both routes are idempotent on `Idempotency-Key`. A retry of the same
 * request returns the cached row id without mutating balances again.
 */
export function fundingRouter(prisma: PrismaClient): Router {
  const r = Router();

  /** GET /api/funding/sources — list rails supported by Add Money / Cash Out. */
  r.get("/sources", (_req, res) => {
    res.json({ success: true, sources: FUNDING_PROVIDERS });
  });

  /** POST /api/funding/add — top up the user's wallet from an external rail. */
  r.post("/add", requireIdempotency, async (req, res) => {
    const idempotencyKey = req.headers["idempotency-key"] as string;
    const parsed = parse(fundingAddSchema, req.body);
    if (!parsed.ok) { fail(res, 400, parsed.error); return; }
    const { userId, amount, source, memo: rawMemo } = parsed.value;
    const memo = rawMemo ?? `Top-up via ${source}`;

    if (amount > config.maxTransferCents) {
      fail(res, 400, `Amount exceeds per-transfer cap of ${fmtBDT(config.maxTransferCents)}`);
      return;
    }

    try {
      const existing = await prisma.transaction.findUnique({ where: { idempotencyKey } });
      if (existing) {
        res.json({ success: true, transactionId: existing.id, message: "Returned cached result" });
        return;
      }
      const result = await prisma.$transaction(async (tx) => {
        const user = await lockUser(tx, userId);
        if (!user) throw new Error("User not found");

        // Add-money cap is its own ceiling so a generous top-up can't be
        // confused with a same-day spend limit. Use the same settlement-day
        // key (Asia/Dhaka) as `assertDailyLimit` so the funding window matches
        // the out-spend window — UTC-based slicing would let a Dhaka-night
        // user bypass the cap.
        const now = new Date();
        const todayKey = dayKey(now);
        // Anchor: the earliest instant whose Dhaka-local day-key equals
        // `todayKey`. Approximate by computing UTC midnight then stepping
        // back/forward by the timezone offset derived from Intl. Simpler:
        // use a wide window (previous day's 18:00 UTC to today's 18:00 UTC)
        // — guaranteed to contain all transactions whose settlement-day
        // equals `todayKey` because Asia/Dhaka is fixed UTC+6 with no DST.
        const dStart = new Date(`${todayKey}T00:00:00Z`);
        dStart.setUTCHours(dStart.getUTCHours() - 6);
        const dEnd = new Date(dStart.getTime());
        dEnd.setUTCDate(dEnd.getUTCDate() + 1);

        const todayFundedAgg = await tx.transaction.aggregate({
          where: {
            receiverId: userId,
            category: "FUNDING",
            createdAt: { gte: dStart, lt: dEnd },
            status: "COMPLETED",
          },
          _sum: { amount: true },
        });
        const alreadyFundedToday = todayFundedAgg._sum.amount ?? 0;
        if (alreadyFundedToday + amount > config.fundingDailyLimitCents) {
          throw new Error(
            `Funding daily limit exceeded (${fmtBDT(config.fundingDailyLimitCents)}/day). ${fmtBDT(Math.max(0, config.fundingDailyLimitCents - alreadyFundedToday))} left today.`
          );
        }

        // External (id 0) is debited — we don't care about its balance, and
        // the row is guaranteed by ensureExternalUser() on boot. The catch
        // is defensive for tests that skip boot.
        await tx.user.update({
          where: { id: 0 },
          data: { balance: { decrement: amount } },
        }).catch(() => { /* no-op if External row absent */ });

        await tx.user.update({ where: { id: userId }, data: { balance: { increment: amount } } });

        const t = await tx.transaction.create({
          data: {
            senderId: 0,
            receiverId: userId,
            amount,
            status: "COMPLETED",
            idempotencyKey,
            memo,
            category: "FUNDING",
          },
        });
        await notify(tx, userId, "FUNDING_IN", `Added ${fmtBDT(amount)} from ${source}`, memo);
        return t;
      });
      res.json({ success: true, transactionId: result.id, source });
    } catch (error: unknown) {
      const err = error as { code?: string; message?: string };
      if (err?.code === "P2002") {
        const existing = await prisma.transaction.findUnique({ where: { idempotencyKey } });
        res.json({ success: true, transactionId: existing?.id, message: "Returned cached result (concurrent replay)" });
        return;
      }
      fail(res, 400, err?.message ?? "Funding add failed");
    }
  });

  /** POST /api/funding/withdraw — debit user to an external rail. */
  r.post("/withdraw", requireIdempotency, async (req, res) => {
    const idempotencyKey = req.headers["idempotency-key"] as string;
    const parsed = parse(fundingWithdrawSchema, req.body);
    if (!parsed.ok) { fail(res, 400, parsed.error); return; }
    const { userId, amount, destination, accountRef, memo: rawMemo } = parsed.value;
    const memo = rawMemo ?? `Cash-out to ${destination}${accountRef ? ` ${accountRef}` : ""}`;

    if (amount > config.maxTransferCents) {
      fail(res, 400, `Amount exceeds per-transfer cap of ${fmtBDT(config.maxTransferCents)}`);
      return;
    }

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

        // External balance is bumped — we don't actually care because
        // External never pays out to anyone.
        await tx.user.update({
          where: { id: 0 },
          data: { balance: { increment: amount } },
        }).catch(() => { /* no-op */ });

        const t = await tx.transaction.create({
          data: {
            senderId: userId,
            receiverId: 0,
            amount,
            status: "COMPLETED",
            idempotencyKey,
            memo,
            category: "WITHDRAWAL",
          },
        });
        await notify(tx, userId, "WITHDRAWAL", `Withdrew ${fmtBDT(amount)} to ${destination}`, memo);
        return t;
      });
      res.json({ success: true, transactionId: result.id, destination });
    } catch (error: unknown) {
      const err = error as { code?: string; message?: string };
      if (err?.code === "P2002") {
        const existing = await prisma.transaction.findUnique({ where: { idempotencyKey } });
        res.json({ success: true, transactionId: existing?.id, message: "Returned cached result (concurrent replay)" });
        return;
      }
      fail(res, 400, err?.message ?? "Withdraw failed");
    }
  });

  return r;
}
