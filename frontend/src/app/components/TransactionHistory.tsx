"use client";

/**
 * TransactionHistory.tsx
 *
 * Paginated, searchable, filterable transaction list.
 * Supports: direction filter (all/in/out), category filter, memo search, CSV export.
 *
 * Backend: GET /api/transactions/:userId?direction=&category=&q=&cursor=&limit=
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowDownLeft,
  ArrowUpRight,
  Download,
  Search,
  SlidersHorizontal,
  X,
  RotateCcw,
} from "lucide-react";
import { api, CATEGORIES, CATEGORY_COLORS, exportToCsv, fmtBDT, relativeDate } from "../lib";
import type { TransactionRow, TransactionPage } from "../types";
import {
  Badge,
  Button,
  EmptyState,
  GlassCard,
  Input,
  Select,
  SectionHeader,
  Skeleton,
} from "./ui";

// ─── Direction filter options ─────────────────────────────────────────────────
type Direction = "all" | "in" | "out";

const DIRECTION_LABELS: Record<Direction, string> = {
  all: "All",
  in:  "Received",
  out: "Sent",
};

// ─── Component ────────────────────────────────────────────────────────────────
export function TransactionHistory({
  userId,
  refreshToken,
  onRefund,
}: {
  userId: number;
  /** Increment this from the parent to trigger a hard refresh */
  refreshToken: number;
  /** Issued when the user clicks the inline Refund button on an outgoing row. */
  onRefund?: (originalId: number) => void;
}) {
  const [items, setItems]         = useState<TransactionRow[]>([]);
  const [nextCursor, setNext]     = useState<number | null>(null);
  const [loading, setLoading]     = useState(false);
  const [loadingMore, setMore]    = useState(false);
  const [showFilters, setFilters] = useState(false);

  // Filters
  const [direction, setDirection] = useState<Direction>("all");
  const [category,  setCategory]  = useState("ALL");
  const [search,    setSearch]    = useState("");
  const debouncedSearch           = useDebounce(search, 350);

  // ── Fetch page ─────────────────────────────────────────────────────────────
  const load = useCallback(
    async (cursor?: number) => {
      if (!userId) return;
      const isFirst = cursor === undefined;
      isFirst ? setLoading(true) : setMore(true);
      try {
        const params = new URLSearchParams({
          limit: "25",
          direction,
          ...(category !== "ALL" && { category }),
          ...(debouncedSearch && { q: debouncedSearch }),
          ...(cursor !== undefined && { cursor: String(cursor) }),
        });
        const page = await api<TransactionPage>(
          `/api/transactions/${userId}?${params}`
        );
        setItems((prev) => (isFirst ? page.items : [...prev, ...page.items]));
        setNext(page.nextCursor);
      } catch {
        // keep stale
      } finally {
        isFirst ? setLoading(false) : setMore(false);
      }
    },
    [userId, direction, category, debouncedSearch]
  );

  // Reset and reload when filters or refreshToken change
  useEffect(() => {
    setItems([]);
    setNext(null);
    load();
  }, [load, refreshToken]);

  // ── CSV Export ─────────────────────────────────────────────────────────────
  function handleExport() {
    if (items.length === 0) return;
    const rows = items.map((tx) => ({
      id:        tx.id,
      date:      new Date(tx.createdAt).toISOString(),
      type:      tx.senderId === userId ? "SENT" : "RECEIVED",
      amount:    (tx.amount / 100).toFixed(2),
      currency:  "BDT",
      category:  tx.category,
      memo:      tx.memo ?? "",
      from:      tx.sender.name,
      to:        tx.receiver.name,
      status:    tx.status,
    }));
    exportToCsv(rows, `pstu-wallet-${userId}-${Date.now()}.csv`);
  }

  // ── Render helpers ─────────────────────────────────────────────────────────
  function TxRow({ tx, idx = 0 }: { tx: TransactionRow; idx?: number }) {
    const outgoing   = tx.senderId === userId;
    const party      = outgoing ? tx.receiver : tx.sender;
    const amountStr  = fmtBDT(tx.amount);
    const catColor   = CATEGORY_COLORS[tx.category] ?? "#94A3B8";

    return (
      <motion.li
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.22, delay: Math.min(idx * 0.02, 0.4) }}
        className="flex items-center gap-4 py-3.5 first:pt-0 last:pb-0"
      >
        {/* Direction icon */}
        <div
          className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 border ${
            outgoing
              ? "bg-[var(--negative)]/8 border-[var(--negative)]/20"
              : "bg-[var(--positive)]/8 border-[var(--positive)]/20"
          }`}
        >
          {outgoing
            ? <ArrowUpRight   className="w-4 h-4 text-[var(--negative)]" />
            : <ArrowDownLeft  className="w-4 h-4 text-[var(--positive)]" />}
        </div>

        {/* Details */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-sm font-medium text-[var(--foreground)] truncate">
              {outgoing ? `To ${party.name}` : `From ${party.name}`}
            </p>
            <span
              className="w-2 h-2 rounded-full flex-shrink-0"
              style={{ background: catColor }}
              title={tx.category}
              aria-hidden="true"
            />
          </div>
          {tx.memo && (
            <p className="text-xs text-[var(--muted-foreground)] truncate mt-0.5">{tx.memo}</p>
          )}
          <p className="text-[10px] text-[var(--muted-foreground)]/60 mt-0.5">
            {relativeDate(tx.createdAt)}
          </p>
        </div>

        {/* Amount */}
        <div className="text-right flex-shrink-0">
          <p className={`tabular-nums font-bold text-sm ${outgoing ? "text-[var(--negative)]" : "text-[var(--positive)]"}`}>
            {outgoing ? `-${amountStr}` : `+${amountStr}`}
          </p>
          <p className="text-[10px] text-[var(--muted-foreground)] mt-0.5 uppercase tracking-wide">
            {tx.category}
          </p>
          {tx.status === "REFUNDED" ? (
            <Badge tone="warn" className="mt-1">REFUNDED</Badge>
          ) : outgoing && onRefund && tx.status === "COMPLETED" && tx.category !== "REFUND" ? (
            <button
              onClick={() => onRefund(tx.id)}
              className="mt-1 inline-flex items-center gap-1 text-[10px] font-semibold text-amber-300 hover:text-amber-200 uppercase tracking-wide"
              title="Refund this transaction (within 7 days)"
            >
              <RotateCcw className="w-3 h-3" />
              Refund
            </button>
          ) : null}
        </div>
      </motion.li>
    );
  }

  return (
    <GlassCard>
      <SectionHeader
        icon={<SlidersHorizontal className="w-4 h-4 text-[var(--primary)]" />}
        title="Transaction History"
        badge={
          items.length > 0
            ? <Badge tone="neutral">{items.length}{nextCursor ? "+" : ""}</Badge>
            : undefined
        }
        action={
          <div className="flex items-center gap-2">
            {items.length > 0 && (
              <Button variant="ghost" size="sm" onClick={handleExport} title="Export CSV">
                <Download className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Export</span>
              </Button>
            )}
            <Button
              variant={showFilters ? "secondary" : "ghost"}
              size="sm"
              onClick={() => setFilters((v) => !v)}
            >
              <SlidersHorizontal className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Filters</span>
            </Button>
          </div>
        }
      />

      {/* ── Filter bar ────────────────────────────────────────────────────── */}
      <AnimatePresence>
        {showFilters && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.25 }}
            className="overflow-hidden"
          >
            <div className="grid sm:grid-cols-3 gap-3 mb-6 bg-[var(--muted)] rounded-2xl p-4 border border-[var(--border)]">
              {/* Search */}
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--muted-foreground)] pointer-events-none" />
                <Input
                  type="text"
                  placeholder="Search memo…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-9 pr-8"
                />
                {search && (
                  <button
                    onClick={() => setSearch("")}
                    className="absolute right-3 top-1/2 -translate-y-1/2"
                    aria-label="Clear search"
                  >
                    <X className="w-3.5 h-3.5 text-[var(--muted-foreground)]" />
                  </button>
                )}
              </div>

              {/* Direction */}
              <Select value={direction} onChange={(e) => setDirection(e.target.value as Direction)}>
                {(["all", "in", "out"] as Direction[]).map((d) => (
                  <option key={d} value={d}>{DIRECTION_LABELS[d]}</option>
                ))}
              </Select>

              {/* Category */}
              <Select value={category} onChange={(e) => setCategory(e.target.value)}>
                <option value="ALL">All Categories</option>
                {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </Select>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── List ──────────────────────────────────────────────────────────── */}
      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-14 w-full" />)}
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          icon={<ArrowUpRight className="w-5 h-5 text-[var(--muted-foreground)]" />}
          title="No transactions"
          subtitle={search || category !== "ALL" ? "Try a different filter" : "Transfers will appear here"}
        />
      ) : (
        <>
          <motion.ul
            className="divide-y divide-[var(--border)]"
          >
            {items.map((tx, idx) => <TxRow key={tx.id} tx={tx} idx={idx} />)}
          </motion.ul>

          {nextCursor && (
            <div className="mt-5 text-center">
              <Button
                variant="secondary"
                size="md"
                loading={loadingMore}
                onClick={() => load(nextCursor)}
              >
                Load more
              </Button>
            </div>
          )}
        </>
      )}
    </GlassCard>
  );
}

// ─── useDebounce hook ─────────────────────────────────────────────────────────
function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setDebouncedValue(value), delay);
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [value, delay]);

  return debouncedValue;
}
