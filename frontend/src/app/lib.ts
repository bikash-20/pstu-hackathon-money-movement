// ─── Shared utilities ─────────────────────────────────────────────────────────

export const CATEGORIES = [
  "TRANSFER", "FOOD", "TRANSPORT", "SHOPPING", "BILLS",
  "EDUCATION", "HEALTH", "ENTERTAINMENT", "SAVINGS", "OTHER",
  // Off-wallet flows (mirror backend CATEGORIES)
  "FUNDING", "WITHDRAWAL", "MERCHANT", "REFUND", "FX",
] as const;

export type Category = typeof CATEGORIES[number];

// ─── External payment rails ───────────────────────────────────────────────────
export const FUNDING_PROVIDERS = ["BKASH", "NAGAD", "ROCKET", "BANK", "CARD"] as const;
export type FundingProvider = typeof FUNDING_PROVIDERS[number];

// ─── Recurring-instruction cadence options ────────────────────────────────────
export const RECURRING_CADENCES = ["DAILY", "WEEKLY", "MONTHLY"] as const;
export type RecurringCadence = typeof RECURRING_CADENCES[number];

// ─── FX-supported currencies ──────────────────────────────────────────────────
export const FX_CURRENCIES = ["USD", "EUR", "GBP", "INR"] as const;
export type FxCurrency = typeof FX_CURRENCIES[number];

/**
 * 2026 Bangladeshi festival calendar — surfaces the "Schedule festival
 * bonus" strip when a festival is within 14 days. Hardcoded because the
 * lunar dates are decided by the government each year; the demo ships with
 * a representative list so the festival flow can be demoed without
 * scraping the real calendar.
 */
export const FESTIVALS_2026: ReadonlyArray<{
  key: "EID" | "DURGA_PUJA" | "POHELA_BOISHAKH" | "INDEPENDENCE" | "VICTORY";
  name: string;
  /** First day of the festival window in ISO (Asia/Dhaka local). */
  date: string;
}> = [
  { key: "POHELA_BOISHAKH", name: "Pohela Boishakh (Bengali New Year)", date: "2026-04-14" },
  { key: "EID",             name: "Eid-ul-Fitr",                        date: "2026-03-20" },
  { key: "EID",             name: "Eid-ul-Adha",                        date: "2026-05-27" },
  { key: "INDEPENDENCE",    name: "Independence Day",                   date: "2026-03-26" },
  { key: "VICTORY",         name: "Victory Day",                        date: "2026-12-16" },
  { key: "DURGA_PUJA",      name: "Durga Puja",                         date: "2026-10-18" },
];

/** Return festivals within `windowDays` of `today` (defaults to now). */
export function upcomingFestivals(today: Date = new Date(), windowDays = 14) {
  const horizonMs = today.getTime() + windowDays * 86_400_000;
  return FESTIVALS_2026
    .map((f) => {
      const d = new Date(f.date);
      const daysAway = Math.ceil((d.getTime() - today.getTime()) / 86_400_000);
      return { ...f, dateObj: d, daysAway };
    })
    .filter((f) => f.dateObj.getTime() >= today.getTime() && f.dateObj.getTime() <= horizonMs)
    .sort((a, b) => a.dateObj.getTime() - b.dateObj.getTime());
}

/** Stable shape returned by both `upcomingFestivals` and `/api/festivals/upcoming`. */
export type UpcomingFestival = ReturnType<typeof upcomingFestivals>[number];

// ─── UUID helper ──────────────────────────────────────────────────────────────
export function uuid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto)
    return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

// ─── API base URL ─────────────────────────────────────────────────────────────
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

/** Typed fetch wrapper.  Throws a user-friendly Error on non-2xx responses. */
export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, init);
  const data = await res.json().catch(() => ({}));
  if (!res.ok)
    throw new Error(
      (data as { error?: string }).error ?? `Request failed (${res.status})`
    );
  return data as T;
}

// ─── Currency formatter ───────────────────────────────────────────────────────
/**
 * Format an integer number of paisa (hundredths of a Taka) as a BDT string.
 * e.g. 10000000  →  "৳1,00,000.00"
 * Uses en-IN grouping which gives the South-Asian lakh/crore comma pattern.
 */
export function fmtBDT(cents: number): string {
  const number = new Intl.NumberFormat("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(cents / 100);
  return `৳${number}`;
}

// ─── Date helpers ─────────────────────────────────────────────────────────────
export function relativeDate(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins  = Math.floor(diff / 60_000);
  const hours = Math.floor(diff / 3_600_000);
  const days  = Math.floor(diff / 86_400_000);
  if (mins  < 1)   return "just now";
  if (mins  < 60)  return `${mins}m ago`;
  if (hours < 24)  return `${hours}h ago`;
  if (days  < 7)   return `${days}d ago`;
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

// ─── CSV export ───────────────────────────────────────────────────────────────
export function exportToCsv(
  rows: Array<Record<string, string | number | boolean | null | undefined>>,
  filename: string
): void {
  if (rows.length === 0) return;
  const headers = Object.keys(rows[0]);
  const escape  = (v: unknown) => {
    const s = String(v ?? "");
    return s.includes(",") || s.includes('"') || s.includes("\n")
      ? `"${s.replace(/"/g, '""')}"`
      : s;
  };
  const csv = [
    headers.join(","),
    ...rows.map((r) => headers.map((h) => escape(r[h])).join(",")),
  ].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href     = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ─── Category colour map ──────────────────────────────────────────────────────
export const CATEGORY_COLORS: Record<string, string> = {
  TRANSFER:     "#F2B705",
  FOOD:         "#34D399",
  TRANSPORT:    "#818CF8",
  SHOPPING:     "#FB7185",
  BILLS:        "#F97316",
  EDUCATION:    "#38BDF8",
  HEALTH:       "#A78BFA",
  ENTERTAINMENT:"#F472B6",
  SAVINGS:      "#6EE7B7",
  OTHER:        "#94A3B8",
  // Off-wallet palette — distinct hues so the activity feed
  // separates wallet-internal flows from external-bound ones at a glance.
  FUNDING:      "#22D3EE", // cyan-400  — money coming in
  WITHDRAWAL:   "#FCA5A5", // red-300   — money going out to MFS/Bank
  MERCHANT:     "#A78BFA", // violet    — Daraz / DPDC / etc.
  REFUND:       "#FDE68A", // amber-200 — money coming back
  FX:           "#67E8F9", // cyan-300  — foreign-currency transfer
};

// ─── Low-balance threshold ────────────────────────────────────────────────────
/** Warn the user when spendable balance drops below this value (in cents). */
export const LOW_BALANCE_THRESHOLD_CENTS = 5_000_00; // ৳5,000
