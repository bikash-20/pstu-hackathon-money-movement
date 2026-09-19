import { Router } from "express";
import type { PrismaClient } from "@prisma/client";
import { requireIdempotency } from "../middleware.js";
import { assertDailyLimit, bumpDailySpent, fmtBDT, lockUser, notify } from "../money.js";
import { config } from "../config.js";

/** QR pay codes without any image vendor: the payload
 *  "pstuqr.<receiverId>.<amount>.<nonce>" is rendered by the frontend as a
 *  copyable code and redeemed here with the same ACID guarantees as transfer. */
export function qrRouter(prisma: PrismaClient): Router {
  const r = Router();

  r.post("/issue", async (req, res) => {
    const receiverId = Number(req.body.receiverId);
    const amount = Number(req.body.amount);
    if (!Number.isInteger(receiverId) || receiverId <= 0 || !Number.isInteger(amount) || amount <= 0) {
      res.status(400).json({ error: "receiverId and positive integer amount are required" });
      return;
    }
    if (amount > config.maxTransferCents) {
      res.status(400).json({ error: `Amount exceeds per-transfer cap of ${fmtBDT(config.maxTransferCents)}` });
      return;
    }
    const receiver = await prisma.user.findUnique({ where: { id: receiverId } });
    if (!receiver) {
      res.status(400).json({ error: "Receiver not found" });
      return;
    }
    const nonce = Math.random().toString(36).slice(2, 10);
    const code = `pstuqr.${receiverId}.${amount}.${nonce}`;
    await prisma.auditLog.create({ data: { actorId: receiverId, action: "QR_ISSUE", detail: code } });
    res.json({ success: true, code, receiver: receiver.name, amount });
  });

  r.post("/redeem", requireIdempotency, async (req, res) => {
    const idempotencyKey = req.headers["idempotency-key"] as string;
    const code = String(req.body.code ?? "");
    const senderId = Number(req.body.senderId);
    const memo = typeof req.body.memo === "string" ? req.body.memo.slice(0, 140) : undefined;
    const m = /^pstuqr\.(\d+)\.(\d+)\.([a-z0-9]{6,10})$/.exec(code.trim());
    if (!m || !Number.isInteger(senderId) || senderId <= 0) {
      res.status(400).json({ error: "Invalid code or senderId" });
      return;
    }
    const receiverId = Number(m[1]);
    const amount = Number(m[2]);
    if (senderId === receiverId) {
      res.status(400).json({ error: "Cannot pay yourself via QR" });
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
      res.status(400).json({ error: err?.message ?? "QR redeem failed" });
    }
  });

  return r;
}
