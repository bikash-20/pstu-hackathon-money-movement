import { Router } from "express";
import type { PrismaClient } from "@prisma/client";
import { parse, paySchema, requestSchema } from "../validate.js";
import { fail, requireIdempotency } from "../middleware.js";
import { assertDailyLimit, bumpDailySpent, expiryDate, fmtBDT, isExpired, lockUser, notify } from "../money.js";

export function requestRouter(prisma: PrismaClient): Router {
  const r = Router();

  // POST /api/request — create a money request (auto-expires in 7 days).
  r.post("/", async (req, res) => {
    const parsed = parse(requestSchema, req.body);
    if (!parsed.ok) {
      fail(res, 400, parsed.error);
      return;
    }
    const { requesterId, payerId, amount, note } = parsed.value;
    try {
      const mr = await prisma.moneyRequest.create({
        data: { requesterId, payerId, amount, status: "PENDING", note: note ?? null, expiresAt: expiryDate() },
      });
      await prisma.notification.create({
        data: {
          userId: payerId,
          kind: "REQUEST_IN",
          title: `Payment request for ${fmtBDT(amount)}`,
          body: note ?? null,
        },
      });
      res.json({ success: true, requestId: mr.id });
    } catch {
      fail(res, 500, "Failed to create request");
    }
  });

  // POST /api/request/:id/pay — settle a pending request (idempotent).
  r.post("/:id/pay", requireIdempotency, async (req, res) => {
    const requestId = Number(req.params.id);
    if (!Number.isInteger(requestId) || requestId <= 0) {
      fail(res, 400, "Invalid request id");
      return;
    }
    const idempotencyKey = req.headers["idempotency-key"] as string;
    const parsed = parse(paySchema, req.body);
    if (!parsed.ok) {
      fail(res, 400, parsed.error);
      return;
    }
    const { payerId } = parsed.value;

    try {
      const existing = await prisma.transaction.findUnique({ where: { idempotencyKey } });
      if (existing) {
        res.json({ success: true, transactionId: existing.id, message: "Returned cached result" });
        return;
      }

      const result = await prisma.$transaction(async (tx) => {
        const rows = await tx.$queryRaw<Array<{ id: number; amount: number; status: string; requesterId: number; payerId: number; expiresAt: Date }>>`
          SELECT id, "amount", "status", "requesterId", "payerId", "expiresAt" FROM "MoneyRequest" WHERE id = ${requestId} FOR UPDATE;`;
        const moneyReq = rows[0];
        if (!moneyReq) throw new Error("Request not found");
        if (moneyReq.payerId !== payerId) throw new Error("Unauthorized payer");
        if (moneyReq.status !== "PENDING") throw new Error("Request is no longer pending");
        if (isExpired(new Date(moneyReq.expiresAt))) {
          await tx.moneyRequest.update({ where: { id: requestId }, data: { status: "EXPIRED" } });
          throw new Error("Request has expired");
        }

        const payer = await lockUser(tx, payerId);
        if (!payer) throw new Error("Payer not found");
        if (payer.balance < moneyReq.amount) throw new Error("Insufficient funds");
        const prevSpent = assertDailyLimit(payer, moneyReq.amount);

        await tx.user.update({ where: { id: payerId }, data: { balance: { decrement: moneyReq.amount } } });
        await bumpDailySpent(tx, payerId, prevSpent, moneyReq.amount);
        await tx.user.update({ where: { id: moneyReq.requesterId }, data: { balance: { increment: moneyReq.amount } } });
        await tx.moneyRequest.update({ where: { id: requestId }, data: { status: "PAID" } });

        const t = await tx.transaction.create({
          data: {
            senderId: payerId,
            receiverId: moneyReq.requesterId,
            amount: moneyReq.amount,
            status: "COMPLETED",
            idempotencyKey,
            category: "TRANSFER",
          },
        });
        await notify(tx, moneyReq.requesterId, "REQUEST_PAID", `Request paid: ${fmtBDT(moneyReq.amount)}`);
        return t;
      });

      res.json({ success: true, transactionId: result.id });
    } catch (error: unknown) {
      const err = error as { code?: string; message?: string };
      if (err?.code === "P2002") {
        const existing = await prisma.transaction.findUnique({ where: { idempotencyKey } });
        res.json({ success: true, transactionId: existing?.id, message: "Returned cached result (concurrent replay)" });
        return;
      }
      fail(res, 400, err?.message ?? "Pay failed");
    }
  });

  // POST /api/request/:id/reject — decline a pending request.
  r.post("/:id/reject", async (req, res) => {
    const requestId = Number(req.params.id);
    if (!Number.isInteger(requestId) || requestId <= 0) {
      fail(res, 400, "Invalid request id");
      return;
    }
    const parsed = parse(paySchema, req.body);
    if (!parsed.ok) {
      fail(res, 400, parsed.error);
      return;
    }
    try {
      const updated = await prisma.moneyRequest.updateMany({
        where: { id: requestId, payerId: parsed.value.payerId, status: "PENDING" },
        data: { status: "REJECTED" },
      });
      if (updated.count === 0) {
        fail(res, 400, "Request not found, not yours, or no longer pending");
        return;
      }
      res.json({ success: true });
    } catch {
      fail(res, 500, "Failed to reject request");
    }
  });

  return r;
}
