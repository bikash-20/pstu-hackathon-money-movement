export const config = {
  port: Number(process.env.PORT || 4000),
  // Comma-separated origins; "*" (default) keeps local + Vercel preview deploys working.
  corsOrigins: (process.env.CORS_ORIGINS || "*").split(",").map((s) => s.trim()),
  // Optional shared secret guarding POST /api/admin/reset. Empty = open (hackathon default).
  adminSecret: process.env.ADMIN_SECRET || "",
  // Per-transfer ceiling: ৳50,000 in cents. Above this, split into tranches.
  maxTransferCents: Number(process.env.MAX_TRANSFER_CENTS || 5_000_000),
  // Daily spend circuit-breaker per user: ৳200,000 in cents, UTC day window.
  dailyLimitCents: Number(process.env.DAILY_LIMIT_CENTS || 20_000_000),
  requestExpiryDays: 7,
} as const;

export const CATEGORIES = [
  "TRANSFER",
  "FOOD",
  "TRANSPORT",
  "SHOPPING",
  "BILLS",
  "EDUCATION",
  "HEALTH",
  "ENTERTAINMENT",
  "SAVINGS",
  "OTHER",
] as const;

export type Category = (typeof CATEGORIES)[number];
