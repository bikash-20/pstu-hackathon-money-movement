import { Router } from "express";
import type { PrismaClient } from "@prisma/client";
import { parse, refundSchema } from "../validate.js";
import { fail, requireIdempotency } from "../middleware.js";
import { fmtBDT, lockUser, notify } from "../money.js";

/**
 * Refund flow.
 *
 * A refund reverses an existing Transaction atomically by inserting a new
 * Transaction row that mirrors the original (sender ↔ receiver swapped,
 * amount equal, category REFUND) and flipping the original's status to
 * REFUNDED. The two operations run inside a single `prisma.$transaction`
 * so partial refunds are impossible.
 *
 * Rules:
 *   • Only the original sender may issue a refund (Zod validates the
 *     requesterId matches; route re-checks at query time).
 *   • Window: 7 days since `original.createdAt`.
 *   • Original must be `COMPLETED` and not already `REFUNDED`.
 *   • A refund is a *credit* to the original sender, so we don't bump
 *     dailySpent on either party (refunds don't penalize the recipient
 *     and don't burn the sender's daily out-spend ceiling).
 */
const REFUND_WINDOW_DAYS = 7;

export function refundsRouter(prisma: PrismaClient): Router {
  const r = Router();

  /** GET /api/refunds/:userId — list recent refunds visible to this user. */
  r.get("/:userId", async (req, res) => {
    const userId = Number(req.params.userId);
    if (!Number.isInteger(userId) || userId <= 0) { fail(res, 400, "Invalid user id"); return; }
    const rows = await prisma.transaction.findMany({
      where: {
        category: "REFUND",
        OR: [{ senderId: userId }, { receiverId: userId }],
      },
      orderBy: { id: "desc" },
      take: 50,
      include: {
        sender:   { select: { id: true, name: true } },
        receiver: { select: { id: true, name: true } },
      },
    });
    res.json(rows);
  });

  /** POST /api/refunds — issue a refund for an existing transaction. */
  r.post("/", requireIdempotency, async (req, res) => {
    const idempotencyKey = req.headers["idempotency-key"] as string;
    const parsed = parse(refundSchema, req.body);
    if (!parsed.ok) { fail(res, 400, parsed.error); return; }
    const { originalId, requesterId, reason } = parsed.value;

    const original = await prisma.transaction.findUnique({ where: { id: originalId } });
    if (!original) { fail(res, 404, "Original transaction not found"); return; }

    // Authorisation: only the original sender may refund.
    if (original.senderId !== requesterId) {
      fail(res, 403, "Only the original sender can issue a refund");
      return;
    }
    // Idempotent replay: if we already refunded this id, return the cached row.
    if (original.status === "REFUNDED") {
      fail(res, 400, "This transaction has already been refunded");
      return;
    }
    if (original.status !== "COMPLETED") {
      fail(res, 400, "Only completed transactions can be refunded");
      return;
    }
    // 7-day window since the original.
    const ageMs = Date.now() - original.createdAt.getTime();
    if (ageMs > REFUND_WINDOW_DAYS * 86_400_000) {
      fail(res, 400, `Refund window expired (${REFUND_WINDOW_DAYS} days)`);
      return;
    }

    const refundMemo = `Refund of #${original.id}${reason ? ` · ${reason}` : ""}`;

    try {
      const existingRefund = await prisma.transaction.findUnique({ where: { idempotencyKey } });
      if (existingRefund) {
        res.json({ success: true, refundId: existingRefund.id, message: "Returned cached result" });
        return;
      }

      const result = await prisma.$transaction(async (tx) => {
        // Lock the receiver (original sender) — they're getting credited.
        const recipient = await lockUser(tx, original.senderId);
        if (!recipient) throw new Error("Original sender not found");
        // Lock the original receiver — they're getting debited back.
        const debitParty = await lockUser(tx, original.receiverId);
        if (!debitParty) throw new Error("Original receiver not found");
        if (debitParty.balance < original.amount) throw new Error("Original receiver has insufficient balance to refund");

        await tx.user.update({
          where: { id: original.senderId },
          data: { balance: { increment: original.amount } },
        });
        await tx.user.update({
          where: { id: original.receiverId },
          data: { balance: { decrement: original.amount } },
        });

        const refund = await tx.transaction.create({
          data: {
            senderId: original.receiverId,
            receiverId: original.senderId,
            amount: original.amount,
            status: "COMPLETED",
            idempotencyKey,
            memo: refundMemo,
            category: "REFUND",
            merchantCode: original.merchantCode ?? null,
          },
        });
        await tx.transaction.update({
          where: { id: original.id },
          data: { status: "REFUNDED" },
        });
        await notify(
          tx, original.senderId, "REFUND",
          `Refund received: ${fmtBDT(original.amount)}`,
          refundMemo,
        );
        return refund;
      });
      res.json({ success: true, refundId: result.id, originalId: original.id });
    } catch (error: unknown) {
      const err = error as { code?: string; message?: string };
      if (err?.code === "P2002") {
        const existingRefund = await prisma.transaction.findUnique({ where: { idempotencyKey } });
        res.json({ success: true, refundId: existingRefund?.id, message: "Returned cached result (concurrent replay)" });
        return;
      }
      fail(res, 400, err?.message ?? "Refund failed");
    }
  });

  return r;
}
