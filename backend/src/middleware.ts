import type { NextFunction, Request, Response } from "express";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import type { PrismaClient } from "@prisma/client";
import { config } from "./config.js";

export interface ApiErrorBody {
  success: false;
  error: string;
}

/** Every error response carries `success: false` so clients (and the legacy
 *  hackathon test script) can branch on one field instead of status codes. */
export function fail(res: Response, status: number, error: string): void {
  res.status(status).json({ success: false, error } satisfies ApiErrorBody);
}


/** Combine real client IP (trust-proxy aware) with an optional user id so one
 *  abusive account cannot exhaust the shared IP bucket (e.g. campus NAT). */
function keyByIpAndUser(req: Request): string {
  const ip = ipKeyGenerator(req as unknown as string);
  const bodyUser =
    (req.body as { senderId?: unknown; payerId?: unknown; initiatorId?: unknown; requesterId?: unknown } | undefined);
  const uid =
    bodyUser?.senderId ?? bodyUser?.payerId ?? bodyUser?.initiatorId ?? bodyUser?.requesterId ?? "";
  return `${ip}:${String(uid)}`;
}

export const moneyWriteLimiter = rateLimit({
  windowMs: 60_000,
  limit: 30, // 30 money movements / minute / (ip+user)
  standardHeaders: "draft-7",
  legacyHeaders: false,
  keyGenerator: keyByIpAndUser,
  message: { success: false, error: "Too many money requests — slow down and retry in a minute." } satisfies ApiErrorBody,
});

export const generalLimiter = rateLimit({
  windowMs: 60_000,
  limit: 120,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  keyGenerator: (req) => ipKeyGenerator(req as unknown as string),
  message: { success: false, error: "Rate limit exceeded — retry shortly." } satisfies ApiErrorBody,
});

/** Require the Idempotency-Key header on money-mutating routes. */
export function requireIdempotency(req: Request, res: Response, next: NextFunction): void {
  const key = req.headers["idempotency-key"];
  if (typeof key !== "string" || key.trim().length === 0 || key.length > 128) {
    fail(res, 400, "Idempotency-Key header is required (1-128 chars)");
    return;
  }
  next();
}

/** Guard POST /api/admin/reset when ADMIN_SECRET is configured. */
export function requireAdminSecret(req: Request, res: Response, next: NextFunction): void {
  if (!config.adminSecret) {
    next();
    return;
  }
  const provided = req.headers["x-admin-secret"];
  if (provided !== config.adminSecret) {
    fail(res, 403, "Forbidden");
    return;
  }
  next();
}

/**
 * Centralised idempotency-replay handler. Every money-mutating route has the
 * same "look up by key, replay if found, else run, catch P2002 concurrent
 * replay" preamble — this helper collapses it into one call so the routes
 * stay focused on the business logic.
 *
 * Usage:
 *   await withIdempotency(prisma, res, key, async () => doTheWork(),
 *                         (result) => ({ transactionId: result.id }));
 *
 * On a fresh write it calls `run()`, returns its response.
 * On a hit (or P2002 race) it returns the cached Transaction row with
 * "Returned cached result" in the message.
 * On a non-idempotency error it writes a 400 via `fail()`.
 */
export async function withIdempotency<T>(
  prisma: PrismaClient,
  res: Response,
  idempotencyKey: string,
  run: () => Promise<T>,
  buildFreshResponse: (result: T) => Record<string, unknown>,
): Promise<boolean /* wrote response */> {
  try {
    const existing = await prisma.transaction.findUnique({ where: { idempotencyKey } });
    if (existing) {
      res.json({ success: true, ...buildFreshResponse(existing as unknown as T), message: "Returned cached result" });
      return true;
    }
    const result = await run();
    res.json({ success: true, ...buildFreshResponse(result) });
    return true;
  } catch (error: unknown) {
    const err = error as { code?: string; message?: string };
    if (err?.code === "P2002") {
      const existing = await prisma.transaction.findUnique({ where: { idempotencyKey } });
      if (existing) {
        res.json({ success: true, ...buildFreshResponse(existing as unknown as T), message: "Returned cached result (concurrent replay)" });
        return true;
      }
    }
    fail(res, 400, err?.message ?? "Request failed");
    return false;
  }
}
