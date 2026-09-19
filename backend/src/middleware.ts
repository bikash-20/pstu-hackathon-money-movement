import type { NextFunction, Request, Response } from "express";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import { config } from "./config.js";

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
  message: { error: "Too many money requests — slow down and retry in a minute." },
});

export const generalLimiter = rateLimit({
  windowMs: 60_000,
  limit: 120,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  keyGenerator: (req) => ipKeyGenerator(req as unknown as string),
  message: { error: "Rate limit exceeded — retry shortly." },
});

/** Require the Idempotency-Key header on money-mutating routes. */
export function requireIdempotency(req: Request, res: Response, next: NextFunction): void {
  const key = req.headers["idempotency-key"];
  if (typeof key !== "string" || key.trim().length === 0 || key.length > 128) {
    res.status(400).json({ error: "Idempotency-Key header is required (1-128 chars)" });
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
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  next();
}
