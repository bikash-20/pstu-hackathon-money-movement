"use client";

/**
 * NotificationPanel.tsx
 *
 * Bell icon with unread badge + slide-down panel.
 * Fetches from GET /api/notifications/:userId, marks read via POST.
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Bell,
  BellDot,
  CheckCheck,
  ArrowDownLeft,
  ArrowUpRight,
  HandCoins,
  Sparkles,
  Info,
  SplitSquareHorizontal,
} from "lucide-react";
import { api, relativeDate } from "../lib";
import type { Notification } from "../types";
import { Badge, Button, EmptyState, Skeleton } from "./ui";

// ─── Kind → icon mapping ──────────────────────────────────────────────────────
const KIND_ICON: Record<string, React.ReactNode> = {
  TRANSFER_IN:   <ArrowDownLeft  className="w-4 h-4 text-[var(--positive)]" />,
  TRANSFER_OUT:  <ArrowUpRight   className="w-4 h-4 text-[var(--negative)]" />,
  REQUEST_IN:    <HandCoins      className="w-4 h-4 text-amber-400" />,
  REQUEST_PAID:  <CheckCheck     className="w-4 h-4 text-[var(--positive)]" />,
  SPLIT_IN:      <SplitSquareHorizontal className="w-4 h-4 text-indigo-400" />,
  GOAL_DONE:     <Sparkles       className="w-4 h-4 text-[var(--primary)]" />,
  SYSTEM:        <Info           className="w-4 h-4 text-[var(--muted-foreground)]" />,
};

// Panel uses inline initial/animate/exit/transition instead of variants to
// avoid framer-motion variant propagation through AnimatePresence.

// ─── Component ────────────────────────────────────────────────────────────────
export function NotificationPanel({ userId }: { userId: number }) {
  const [open, setOpen]               = useState(false);
  const [items, setItems]             = useState<Notification[]>([]);
  const [loading, setLoading]         = useState(false);
  const [markingAll, setMarkingAll]   = useState(false);
  const panelRef                      = useRef<HTMLDivElement>(null);

  const unread = items.filter((n) => !n.read).length;

  // ── Fetch ──────────────────────────────────────────────────────────────────
  const fetch = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    try {
      const data = await api<Notification[]>(`/api/notifications/${userId}`);
      setItems(data);
    } catch {
      // silent — bell just shows stale count
    } finally {
      setLoading(false);
    }
  }, [userId]);

  // Refresh every 30 s and whenever panel opens
  useEffect(() => { fetch(); }, [fetch]);
  useEffect(() => {
    if (open) fetch();
    const id = setInterval(fetch, 30_000);
    return () => clearInterval(id);
  }, [open, fetch]);

  // Close on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  // ── Mark single read ───────────────────────────────────────────────────────
  async function markRead(id: number) {
    setItems((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)));
    await api(`/api/notifications/${id}/read`, { method: "POST" }).catch(() => {});
  }

  // ── Mark all read ──────────────────────────────────────────────────────────
  async function markAllRead() {
    setMarkingAll(true);
    try {
      await api(`/api/notifications/${userId}/read-all`, { method: "POST" });
      setItems((prev) => prev.map((n) => ({ ...n, read: true })));
    } finally {
      setMarkingAll(false);
    }
  }

  return (
    <div className="relative" ref={panelRef}>
      {/* ── Bell trigger ─────────────────────────────────────────────────── */}
      <button
        aria-label={`Notifications${unread > 0 ? `, ${unread} unread` : ""}`}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="relative w-10 h-10 rounded-xl bg-[var(--muted)] border border-[var(--border)] flex items-center justify-center hover:border-[var(--primary)]/40 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
      >
        {unread > 0
          ? <BellDot className="w-5 h-5 text-[var(--primary)]" />
          : <Bell    className="w-5 h-5 text-[var(--muted-foreground)]" />}
        {unread > 0 && (
          <span className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-[var(--negative)] text-white text-[10px] font-bold flex items-center justify-center leading-none">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>

      {/* ── Panel ────────────────────────────────────────────────────────── */}
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -8, scale: 0.97 }}
            animate={{ opacity: 1, y: 0,  scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.97 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            className="absolute right-0 top-12 z-40 w-80 md:w-96 glass rounded-3xl shadow-2xl border border-[var(--primary)]/20 overflow-hidden"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border)]">
              <div className="flex items-center gap-2">
                <Bell className="w-4 h-4 text-[var(--primary)]" />
                <span className="font-semibold text-[var(--foreground)] text-sm">Notifications</span>
                {unread > 0 && <Badge tone="warn">{unread} new</Badge>}
              </div>
              {unread > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={markAllRead}
                  loading={markingAll}
                  className="text-xs"
                >
                  <CheckCheck className="w-3 h-3" />
                  Mark all read
                </Button>
              )}
            </div>

            {/* List */}
            <div className="max-h-96 overflow-y-auto overscroll-contain">
              {loading && items.length === 0 ? (
                <div className="p-4 space-y-3">
                  {Array.from({ length: 3 }).map((_, i) => (
                    <Skeleton key={i} className="h-14 w-full" />
                  ))}
                </div>
              ) : items.length === 0 ? (
                <EmptyState
                  icon={<Bell className="w-5 h-5 text-[var(--muted-foreground)]" />}
                  title="No notifications yet"
                  subtitle="Transfers and requests will appear here"
                />
              ) : (
                <motion.ul className="divide-y divide-[var(--border)]">
                  {items.map((n, idx) => (
                    <motion.li
                      key={n.id}
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: n.read ? 0.6 : 1, y: 0 }}
                      exit={{ opacity: 0, x: 16 }}
                      transition={{ duration: 0.22, delay: Math.min(idx * 0.03, 0.3) }}
                      onClick={() => !n.read && markRead(n.id)}
                      className={`flex items-start gap-3 px-5 py-3.5 cursor-pointer transition-colors ${
                        n.read
                          ? "hover:opacity-80"
                          : "hover:bg-[var(--muted)]"
                      }`}
                    >
                      <div className="w-8 h-8 rounded-xl bg-[var(--muted)] border border-[var(--border)] flex items-center justify-center flex-shrink-0 mt-0.5">
                        {KIND_ICON[n.kind] ?? <Info className="w-4 h-4" />}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className={`text-sm leading-snug truncate ${n.read ? "text-[var(--muted-foreground)]" : "text-[var(--foreground)] font-medium"}`}>
                          {n.title}
                        </p>
                        {n.body && (
                          <p className="text-xs text-[var(--muted-foreground)] truncate mt-0.5">{n.body}</p>
                        )}
                        <p className="text-[10px] text-[var(--muted-foreground)]/60 mt-1">{relativeDate(n.createdAt)}</p>
                      </div>
                      {!n.read && (
                        <span className="w-2 h-2 rounded-full bg-[var(--primary)] flex-shrink-0 mt-1.5" aria-hidden="true" />
                      )}
                    </motion.li>
                  ))}
                </motion.ul>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
