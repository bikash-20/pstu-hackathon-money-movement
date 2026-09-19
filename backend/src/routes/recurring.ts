import { Router } from "express";
import type { PrismaClient } from "@prisma/client";
import { parse, recurringSchema } from "../validate.js";
import { fail } from "../middleware.js";
import { fmtBDT } from "../money.js";
import type { RecurringCadence } from "../config.js";

/**
 * Standing instructions.
 *
 * A user creates an instruction (`cadence` + `amount` + `recipient` +
 * `startAt`). `POST /api/recurring/settle` materializes any due rows into
 * the existing `Transaction` ledger with `status: "SCHEDULED:<iso>"` —
 * which the existing `POST /api/scheduled/settle` then settles on the next
 * cron tick (or demo button click). This means the recurring feature
 * piggy-backs on the proven scheduler rather than inventing a parallel
 * worker loop.
 *
 * `nextRunAt` advances by the cadence interval after each successful
 * materialization. An inactive row is never picked up by `settle`.
 */

function advance(date: Date, cadence: RecurringCadence): Date {
  const next = new Date(date.getTime());
  if (cadence === "DAILY") next.setUTCDate(next.getUTCDate() + 1);
  else if (cadence === "WEEKLY") next.setUTCDate(next.getUTCDate() + 7);
  else next.setUTCMonth(next.getUTCMonth() + 1);
  return next;
}

export function recurringRouter(prisma: PrismaClient): Router {
  const r = Router();

  /** GET /api/recurring/:userId — list the user's standing instructions. */
  r.get("/:userId", async (req, res) => {
    const userId = Number(req.params.userId);
    if (!Number.isInteger(userId) || userId <= 0) { fail(res, 400, "Invalid user id"); return; }
    const rows = await prisma.recurringInstruction.findMany({
      where: { userId },
      orderBy: { id: "desc" },
      include: { recipient: { select: { id: true, name: true } } },
    });
    res.json(rows);
  });

  /** POST /api/recurring — create a new standing instruction. */
  r.post("/", async (req, res) => {
    const parsed = parse(recurringSchema, req.body);
    if (!parsed.ok) { fail(res, 400, parsed.error); return; }
    const { userId, recipientId, amount, cadence, startAt, memo, category } = parsed.value;

    const recipient = await prisma.user.findUnique({ where: { id: recipientId } });
    if (!recipient) { fail(res, 400, "Recipient not found"); return; }

    const start = new Date(startAt);
    if (Number.isNaN(start.getTime()) || start.getTime() <= Date.now()) {
      fail(res, 400, "startAt must be a future ISO datetime");
      return;
    }

    try {
      const row = await prisma.recurringInstruction.create({
        data: {
          userId, recipientId, amount,
          cadence,
          startAt: start,
          nextRunAt: start,
          memo: memo ?? null,
          category,
        },
      });
      res.json({ success: true, instruction: row });
    } catch (error: unknown) {
      const err = error as { code?: string; message?: string };
      fail(res, 400, err?.message ?? "Failed to create instruction");
    }
  });

  /** DELETE /api/recurring/:id — soft-cancel (set active: false). */
  r.delete("/:id", async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) { fail(res, 400, "Invalid instruction id"); return; }
    const row = await prisma.recurringInstruction.update({
      where: { id },
      data: { active: false },
    }).catch(() => null);
    if (!row) { fail(res, 404, "Instruction not found"); return; }
    res.json({ success: true, instruction: row });
  });

  /** POST /api/recurring/settle — materialize due legs into SCHEDULED rows. */
  r.post("/settle", async (_req, res) => {
    try {
      const now = new Date();
      const due = await prisma.recurringInstruction.findMany({
        where: { active: true, nextRunAt: { lte: now } },
        orderBy: { nextRunAt: "asc" },
        take: 50,
      });
      let materialized = 0;
      let advanced = 0;
      let failed = 0;
      for (const inst of due) {
        try {
          // Idempotency key derived from the instruction + scheduled time,
          // so a re-run of settle won't duplicate the leg.
          const idempotencyKey = `rec:${inst.id}:${inst.nextRunAt.toISOString()}`;
          await prisma.$transaction(async (tx) => {
            // Lock the instruction row FOR UPDATE so two parallel /settle
            // calls don't both advance `nextRunAt` (double-cadence jump).
            const locked = await tx.$queryRaw<Array<{ id: number; active: boolean; nextRunAt: Date }>>`
              SELECT id, active, "nextRunAt" FROM "RecurringInstruction"
              WHERE id = ${inst.id} FOR UPDATE;`;
            const fresh = locked[0];
            if (!fresh || !fresh.active) {
              advanced++;
              return;
            }
            const existing = await tx.transaction.findUnique({ where: { idempotencyKey } });
            if (existing) {
              advanced++;
              return;
            }
            await tx.transaction.create({
              data: {
                senderId: inst.userId,
                receiverId: inst.recipientId,
                amount: inst.amount,
                status: `SCHEDULED:${inst.nextRunAt.toISOString()}`,
                idempotencyKey,
                memo: inst.memo ?? `Recurring ${inst.cadence.toLowerCase()}`,
                category: inst.category,
              },
            });
            // Advance nextRunAt inside the lock so the next /settle sees the
            // updated value.
            await tx.recurringInstruction.update({
              where: { id: inst.id },
              data: { nextRunAt: advance(fresh.nextRunAt, inst.cadence as RecurringCadence) },
            });
            materialized++;
            advanced++;
          });
        } catch {
          failed++;
        }
      }
      res.json({ success: true, materialized, advanced, failed, scanned: due.length });
    } catch (error: unknown) {
      fail(res, 500, (error as { message?: string }).message ?? "Settle failed");
    }
  });

  return r;
}
