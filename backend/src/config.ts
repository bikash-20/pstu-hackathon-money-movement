export const config = {
  port: Number(process.env.PORT || 4000),
  // Comma-separated origins; "*" (default) keeps local + Vercel preview deploys working.
  corsOrigins: (process.env.CORS_ORIGINS || "*").split(",").map((s) => s.trim()),
  // Optional shared secret guarding POST /api/admin/reset. Empty = open (hackathon default).
  adminSecret: process.env.ADMIN_SECRET || "",
  // Per-transfer ceiling: ৳50,000 in cents. Above this, split into tranches.
  maxTransferCents: Number(process.env.MAX_TRANSFER_CENTS || 5_000_000),
  // Daily spend circuit-breaker per user: ৳200,000 in cents.
  dailyLimitCents: Number(process.env.DAILY_LIMIT_CENTS || 20_000_000),
  // Business timezone that defines a "settlement day" for daily limits.
  // A Bangladeshi wallet settles on Asia/Dhaka days, not UTC days.
  timezone: process.env.WALLET_TIMEZONE || "Asia/Dhaka",
  requestExpiryDays: 7,
  // Add-Money daily cap: how much a user can top-up in one settlement day.
  // Independent from the out-spend ceiling (you can't accidentally "limit
  // yourself out" of funding the wallet by spending yesterday).
  fundingDailyLimitCents: Number(process.env.FUNDING_DAILY_LIMIT_CENTS || 50_000_000),
  // FX rates (env-overridable; otherwise static demo values).
  // `FX_<CCY>_BDT` reads e.g. FX_USD_BDT. Stored as paisa-per-foreign-unit × 100
  // … actually as decimal paisa — multiply by 100 at use sites to get cents.
  fxRates: {
    USD: Number(process.env.FX_USD_BDT || 110.00),
    EUR: Number(process.env.FX_EUR_BDT || 120.00),
    GBP: Number(process.env.FX_GBP_BDT || 140.00),
    INR: Number(process.env.FX_INR_BDT || 1.32),
  },
} as const;

export const CATEGORIES = [
  // Wallet-internal flows
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
  // Off-wallet flows (added in external-payments-v3)
  "FUNDING",
  "WITHDRAWAL",
  "MERCHANT",
  "REFUND",
  "FX",
] as const;

export type Category = (typeof CATEGORIES)[number];

/** External payment rails for Add Money / Cash Out. */
export const FUNDING_PROVIDERS = ["BKASH", "NAGAD", "ROCKET", "BANK", "CARD"] as const;
export type FundingProvider = (typeof FUNDING_PROVIDERS)[number];

/** Recurring-instruction cadence options. */
export const RECURRING_CADENCES = ["DAILY", "WEEKLY", "MONTHLY"] as const;
export type RecurringCadence = (typeof RECURRING_CADENCES)[number];

/** FX-supported currencies. */
export const FX_CURRENCIES = ["USD", "EUR", "GBP", "INR"] as const;
export type FxCurrency = (typeof FX_CURRENCIES)[number];
