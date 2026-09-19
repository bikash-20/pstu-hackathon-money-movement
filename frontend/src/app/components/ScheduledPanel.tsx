"use client";

/**
 * ScheduledPanel.tsx
 *
 * Create future-dated transfers + view pending scheduled payments.
 * Backend: GET /api/scheduled/:userId  POST /api/scheduled
 *          POST /api/scheduled/settle  (demo trigger)
 */

import React, { useCallback, useEffect, useState } from "react";
import { motion } from "framer-motion";
import { CalendarClock, Clock, Send, Zap } from "lucide-react";
import { api, CATEGORIES, fmtBDT, uuid } from "../lib";
import type { ScheduledTx, User } from "../types";
import {
  Badge,
  Button,
  ConfirmModal,
  ConfirmState,
  EmptyState,
  GlassCard,
  Input,
  Label,
  SectionHeader,
  Select,
  Skeleton,
  fadeUp,
  stagger,
} from "./ui";

// ─── Helpers ──────────────────────────────────────────────────────────────────
function parseScheduledDate(status: string): string {
  const iso = status.replace("SCHEDULED:", "");
  const d   = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString("en-BD", { dateStyle: "medium", timeStyle: "short" });
}

function isDue(status: string): boolean {
  const iso = status.replace("SCHEDULED:", "");
  return new Date(iso).getTime() <= Date.now();
}

// ─── Component ────────────────────────────────────────────────────────────────
export function ScheduledPanel({
  userId,
  users,
  onToast,
  onBalanceRefresh,
}: {
  userId: number;
  users: User[];
  onToast: (type: "success" | "error", text: string) => void;
  onBalanceRefresh: () => void;
}) {
  const [pending, setPending]     = useState<ScheduledTx[]>([]);
  const [loading, setLoading]     = useState(false);
  const [settling, setSettling]   = useState(false);
  const [confirm, setConfirm]     = useState<ConfirmState>(null);

  // Form
  const [recipientId, setRecipientId] = useState("");
  const [amount, setAmount]           = useState("");
  const [memo, setMemo]               = useState("");
  const [category, setCategory]       = useState("TRANSFER");
  const [executeAt, setExecuteAt]     = useState("");
  const [submitting, setSubmitting]   = useState(false);

  // ── Load pending ───────────────────────────────────────────────────────────
  const load = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    try {
      const data = await api<ScheduledTx[]>(`/api/scheduled/${userId}`);
      setPending(data);
    } catch {
      //
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => { load(); }, [load]);

  // ── Schedule new ───────────────────────────────────────────────────────────
  async function handleSchedule(e: React.FormEvent) {
    e.preventDefault();
    const cents    = Math.round(parseFloat(amount) * 100);
    const receiver = parseInt(recipientId);
    if (!Number.isFinite(cents) || cents <= 0 || !receiver) return;
    if (!executeAt) { onToast("error", "Pick a future date/time"); return; }
    if (new Date(executeAt).getTime() <= Date.now()) {
      onToast("error", "Scheduled time must be in the future");
      return;
    }
    setConfirm({
      title:       "Schedule Transfer",
      description: `Funds won't move until the scheduled time. You can settle early with the "Settle Due Now" button.`,
      amountLabel: fmtBDT(cents),
      onConfirm:   () => executeSchedule(receiver, cents),
    });
  }

  async function executeSchedule(receiver: number, cents: number) {
    setSubmitting(true);
    try {
      await api("/api/scheduled", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": uuid() },
        body: JSON.stringify({
          senderId: userId,
          receiverId: receiver,
          amount: cents,
          memo: memo.trim() || undefined,
          category,
          executeAt: new Date(executeAt).toISOString(),
        }),
      });
      onToast("success", "Transfer scheduled!");
      setAmount(""); setMemo(""); setExecuteAt(""); setRecipientId("");
      load();
    } catch (err) {
      onToast("error", (err as Error).message ?? "Schedule failed");
    } finally {
      setSubmitting(false);
    }
  }

  // ── Settle due ─────────────────────────────────────────────────────────────
  async function settleDue() {
    setSettling(true);
    try {
      const res = await api<{ success: boolean; settled: number; skipped: number }>(
        "/api/scheduled/settle",
        { method: "POST" }
      );
      onToast("success", `${res.settled} transfer(s) settled, ${res.skipped} skipped`);
      load();
      onBalanceRefresh();
    } catch (err) {
      onToast("error", (err as Error).message ?? "Settle failed");
    } finally {
      setSettling(false);
    }
  }

  const dueCount = pending.filter((t) => isDue(t.status)).length;
  const others   = users.filter((u) => u.id !== userId);

  // Minimum datetime-local value = now + 1 min
  const minDateTime = new Date(Date.now() + 60_000).toISOString().slice(0, 16);

  return (
    <>
      <ConfirmModal state={confirm} onClose={() => setConfirm(null)} />

      <GlassCard>
        <SectionHeader
          icon={<CalendarClock className="w-4 h-4 text-[var(--primary)]" />}
          title="Scheduled Transfers"
          badge={pending.length > 0 ? <Badge tone="neutral">{pending.length} pending</Badge> : undefined}
          action={
            dueCount > 0 ? (
              <Button variant="primary" size="sm" loading={settling} onClick={settleDue}>
                <Zap className="w-3.5 h-3.5" />
                Settle Due ({dueCount})
              </Button>
            ) : undefined
          }
        />

        {/* ── Schedule form ─────────────────────────────────────────────── */}
        <form onSubmit={handleSchedule} className="space-y-4 mb-8">
          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <Label htmlFor="sched-recipient">Recipient</Label>
              <Select
                id="sched-recipient"
                required
                value={recipientId}
                onChange={(e) => setRecipientId(e.target.value)}
              >
                <option value="" disabled>Select user</option>
                {others.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}{u.phone ? ` · ${u.phone}` : ""}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="sched-amount">Amount (BDT)</Label>
              <Input
                id="sched-amount"
                type="number"
                min={1}
                step="0.01"
                required
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="e.g. 2000"
              />
            </div>
          </div>

          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <Label htmlFor="sched-when">Execute At</Label>
              <Input
                id="sched-when"
                type="datetime-local"
                required
                min={minDateTime}
                value={executeAt}
                onChange={(e) => setExecuteAt(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="sched-cat">Category</Label>
              <Select
                id="sched-cat"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
              >
                {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </Select>
            </div>
          </div>

          <div>
            <Label htmlFor="sched-memo">Memo (optional)</Label>
            <Input
              id="sched-memo"
              type="text"
              maxLength={140}
              value={memo}
              onChange={(e) => setMemo(e.target.value)}
              placeholder="What's this for?"
            />
          </div>

          <Button type="submit" variant="primary" size="lg" loading={submitting}>
            <Send className="w-4 h-4" />
            Schedule Transfer
          </Button>
        </form>

        {/* ── Pending list ──────────────────────────────────────────────── */}
        {loading && pending.length === 0 ? (
          <div className="space-y-3">
            {[1, 2].map((i) => <Skeleton key={i} className="h-16 w-full" />)}
          </div>
        ) : pending.length === 0 ? (
          <EmptyState
            icon={<Clock className="w-5 h-5 text-[var(--muted-foreground)]" />}
            title="No scheduled transfers"
            subtitle="Future-dated transfers will appear here"
          />
        ) : (
          <motion.ul variants={stagger} initial="hidden" animate="show" className="divide-y divide-[var(--border)]">
            {pending.map((tx) => {
              const due = isDue(tx.status);
              return (
                <motion.li
                  key={tx.id}
                  variants={fadeUp}
                  className="flex items-center justify-between py-3.5 first:pt-0 last:pb-0"
                >
                  <div className="flex items-center gap-3">
                    <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${due ? "bg-[var(--primary)]/15 border border-[var(--primary)]/30" : "bg-[var(--muted)] border border-[var(--border)]"}`}>
                      <CalendarClock className={`w-4 h-4 ${due ? "text-[var(--primary)]" : "text-[var(--muted-foreground)]"}`} />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-[var(--foreground)]">
                        → {tx.receiver.name}
                      </p>
                      <p className="text-xs text-[var(--muted-foreground)]">
                        {parseScheduledDate(tx.status)}
                      </p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="tabular-nums font-semibold text-[var(--negative)]">
                      -{fmtBDT(tx.amount)}
                    </p>
                    <Badge tone={due ? "warn" : "neutral"} className="mt-1">
                      {due ? "Due" : "Pending"}
                    </Badge>
                  </div>
                </motion.li>
              );
            })}
          </motion.ul>
        )}
      </GlassCard>
    </>
  );
}
