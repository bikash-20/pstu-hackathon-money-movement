// ─── Domain types shared across all components ───────────────────────────────
// Keep these in sync with the Prisma schema in backend/prisma/schema.prisma.

export type User = {
  id: number;
  name: string;
  balance: number; // cents
  phone?: string | null;
};

export type TransactionRow = {
  id: number;
  senderId: number;
  receiverId: number;
  amount: number; // cents
  status: string;
  memo?: string | null;
  category: string;
  /** Wallet-settlement currency. Always "BDT" for wallet-internal flows;
   *  carries the source currency for FX transfers (the BDT amount is in `amount`). */
  currency?: string;
  /** Set on merchant-checkout rows so the activity feed can resolve the
   *  merchant name from the directory even after the row is archived. */
  merchantCode?: string | null;
  /** Optional festival tag (EID, DURGA_PUJA, …) so the activity feed can
   *  group festival payments together. */
  festivalTag?: string | null;
  createdAt: string;
  sender: { id: number; name: string; phone?: string | null };
  receiver: { id: number; name: string; phone?: string | null };
};

export type MoneyRequest = {
  id: number;
  amount: number; // cents
  status: string;
  note?: string | null;
  expiresAt: string;
  createdAt: string;
  requester: { name: string; phone?: string | null };
  payer?: { name: string; phone?: string | null };
  /** Computed lazily on the server when listing outgoing requests:
   *  true when the request is still PENDING but past its expiry timestamp. */
  expired?: boolean;
};

export type Contact = {
  id: number;
  ownerId: number;
  contactId: number;
  nickname?: string | null;
  contact?: User | null;
};

export type Notification = {
  id: number;
  kind: string;
  title: string;
  body?: string | null;
  read: boolean;
  createdAt: string;
};

export type Goal = {
  id: number;
  userId: number;
  name: string;
  targetAmount: number; // cents
  savedAmount: number;  // cents
  createdAt: string;
  completedAt?: string | null;
};

export type InsightBreakdown = {
  category: string;
  total: number; // cents
  count: number;
  pct: number;
};

export type InsightsData = {
  userId: number;
  days: number;
  totalOut: number; // cents
  count: number;
  breakdown: InsightBreakdown[];
};

export type ScheduledTx = {
  id: number;
  senderId: number;
  receiverId: number;
  amount: number;
  status: string; // "SCHEDULED:<iso>"
  memo?: string | null;
  category: string;
  createdAt: string;
  receiver: { id: number; name: string };
};

export type TransactionPage = {
  items: TransactionRow[];
  nextCursor: number | null;
};

// ─── External-payments v3 types ───────────────────────────────────────────────

/** Merchant directory entry as returned by /api/merchant and /api/merchant/:code. */
export type Merchant = {
  id: number;
  code: string;
  name: string;
  /** Mirrors one of CATEGORIES (SHOPPING, FOOD, BILLS, TRANSPORT, …). */
  category: string;
  /** Optional payment-rail hint ("BKASH" | "NAGAD" | "ROCKET" | null). */
  mfsProvider?: string | null;
};

/** A standing instruction (rent, salary, EMI, festival bonus, …). */
export type RecurringInstruction = {
  id: number;
  userId: number;
  recipientId: number;
  amount: number; // cents per leg
  /** "DAILY" | "WEEKLY" | "MONTHLY". */
  cadence: string;
  startAt: string;
  nextRunAt: string;
  active: boolean;
  memo?: string | null;
  category: string;
  recipient?: { id: number; name: string } | null;
};

/** Festival entry from /api/festivals/upcoming. */
export type Festival = {
  key: "EID" | "DURGA_PUJA" | "POHELA_BOISHAKH" | "INDEPENDENCE" | "VICTORY";
  name: string;
  date: string;
  dateObj: string;
  daysAway: number;
};

// ─── Confirm-modal payload ────────────────────────────────────────────────────
export type ConfirmPayload = {
  title: string;
  description: string;
  amount: number; // cents – shown in the confirmation dialog
  onConfirm: () => Promise<void>;
};
