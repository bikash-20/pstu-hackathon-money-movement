import { Router } from "express";
import type { PrismaClient } from "@prisma/client";
import { fail, requireIdempotency } from "../middleware.js";
import { assertDailyLimit, bumpDailySpent, fmtBDT, lockUser, notify } from "../money.js";
import { config } from "../config.js";
import { z } from "zod";

/** QR pay codes without any image vendor: the payload
 *  "pstuqr.<receiverId>.<amount>.<nonce>" is rendered by the frontend as a
 *  copyable code and redeemed here with the same ACID guarantees as transfer. */

// Inline Zod schema for /issue: keep it close to the route that uses it.
const qrIssueSchema = z.object({
  receiverId: z.number().int().positive(),
  amount: z.number().int().positive().max(100_000_000),
});

export function qrRouter(prisma: PrismaClient): Router {
  const r = Router();

  r.post("/issue", async (req, res) => {
    // Zod gives us a uniform error path and rejects NaN / strings / arrays.
    const parsed = qrIssueSchema.safeParse(req.body);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      fail(res, 400, `${first?.path.join(".") || "body"}: ${first?.message ?? "Invalid request body"}`);
      return;
    }
    const { receiverId, amount } = parsed.data;

    if (amount > config.maxTransferCents) {
      fail(res, 400, `Amount exceeds per-transfer cap of ${fmtBDT(config.maxTransferCents)}`);
      return;
    }
    const receiver = await prisma.user.findUnique({ where: { id: receiverId } });
    if (!receiver) {
      fail(res, 400, "Receiver not found");
      return;
    }
    // Nonce: 8 chars of base36 ≈ 41 bits of entropy; QR codes are short-lived,
    // so this is enough to make accidental collisions vanishingly rare.
    const nonce = Math.random().toString(36).slice(2, 10);
    const code = `pstuqr.${receiverId}.${amount}.${nonce}`;
    await prisma.auditLog.create({ data: { actorId: receiverId, action: "QR_ISSUE", detail: code } });
    res.json({ success: true, code, receiver: receiver.name, amount });
  });

  r.post("/redeem", requireIdempotency, async (req, res) => {
    const idempotencyKey = req.headers["idempotency-key"] as string;

    // Validate code/senderId/memo via Zod (uniform error shape across all
    // money routes). `code` is a string payload, so a small object schema
    // is enough.
    const qrRedeemSchema = z.object({
      senderId: z.number().int().positive(),
      code: z.string().trim().min(1).max(64),
      memo: z.string().trim().max(140).optional(),
    });
    const parsed = qrRedeemSchema.safeParse(req.body);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      fail(res, 400, `${first?.path.join(".") || "body"}: ${first?.message ?? "Invalid request body"}`);
      return;
    }
    const { senderId, code, memo } = parsed.data;

    const m = /^pstuqr\.(\d+)\.(\d+)\.([a-z0-9]{6,10})$/.exec(code);
    if (!m) {
      fail(res, 400, "Invalid code or senderId");
      return;
    }
    const receiverId = Number(m[1]);
    const amount = Number(m[2]);
    if (senderId === receiverId) {
      fail(res, 400, "Cannot pay yourself via QR");
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
          data: { senderId, receiverId, amount, status: "COMPLETED", idempotencyKey, memo: memo ?? null, category: "TRANSFER" },
        });
        await notify(tx, receiverId, "TRANSFER_IN", `QR payment received: ${fmtBDT(amount)}`, memo);
        return t;
      });
      res.json({ success: true, transactionId: result.id });
    } catch (error: unknown) {
      const err = error as { code?: string; message?: string };
      if (err?.code === "P2002") {
        res.json({ success: true, message: "Returned cached result (concurrent replay)" });
        return;
      }
      fail(res, 400, err?.message ?? "QR redeem failed");
    }
  });

  return r;
}
