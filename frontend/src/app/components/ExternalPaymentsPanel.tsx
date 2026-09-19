"use client";

/**
 * ExternalPaymentsPanel.tsx
 *
 * Single panel that hosts all five off-wallet flows introduced in
 * external-payments-v3:
 *
 *   1. Add Money      — top up the wallet from bKash / Nagad / Rocket / Bank / Card.
 *   2. Cash Out       — withdraw to the same rails.
 *   3. Merchant Pay   — pay a merchant directory entry by code (Daraz, DPDC, GP…).
 *   4. Recurring      — create a standing instruction (rent / salary / EMI / festival bonus).
 *   5. FX Transfer    — convert USD/EUR/GBP/INR → BDT and send.
 *
 * All flows reuse the existing Transfer / Transaction plumbing server-side
 * (see backend/src/routes/funding.ts, merchant.ts, recurring.ts, fx.ts).
 *
 * Festival strip — surfaces an upcoming festival within 14 days with a
 * pre-filled "Schedule festival bonus" button.
 */

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  PlusCircle, MinusCircle, ShoppingBag, Repeat, Globe, Gift,
  CalendarClock,
} from "lucide-react";
import {
  FUNDING_PROVIDERS, RECURRING_CADENCES, FX_CURRENCIES,
  api, fmtBDT, uuid,
} from "../lib";
import type { UpcomingFestival } from "../lib";
import type { Merchant, RecurringInstruction, User } from "../types";
import {
  Badge, Button, GlassCard, Input, Label, Select, EmptyState, fadeUp,
} from "./ui";

type Flow = "add" | "withdraw" | "merchant" | "recurring" | "fx";

const FLOW_TABS: { id: Flow; label: string; icon: React.ReactNode }[] = [
  { id: "add",       label: "Add Money",  icon: <PlusCircle  className="w-4 h-4" /> },
  { id: "withdraw",  label: "Cash Out",   icon: <MinusCircle className="w-4 h-4" /> },
  { id: "merchant",  label: "Merchants",  icon: <ShoppingBag className="w-4 h-4" /> },
  { id: "recurring", label: "Recurring",  icon: <Repeat      className="w-4 h-4" /> },
  { id: "fx",        label: "FX",         icon: <Globe       className="w-4 h-4" /> },
];

// ─── FX rate snapshot (the panel mirrors the server's table so users see the
// live conversion before clicking). The server is the source of truth — these
// values are only for the UI preview.
const FX_PREVIEW: Record<string, number> = { USD: 110.00, EUR: 120.00, GBP: 140.00, INR: 1.32 };

export function ExternalPaymentsPanel({
  userId,
  users,
  onToast,
  onBalanceRefresh,
}: {
  userId: number;
  users: User[];
  onToast: (type: "success" | "error" | "warn", text: string) => void;
  onBalanceRefresh: () => Promise<void> | void;
}) {
  const [flow, setFlow] = useState<Flow>("add");
  const [busy, setBusy]   = useState(false);

  // Festival strip — populated by the single source of truth at /api/festivals/upcoming.
  const [festivals, setFestivals] = useState<UpcomingFestival[]>([]);

  // Merchant directory
  const [merchants, setMerchants] = useState<Merchant[]>([]);

  // Standing instructions list (visible on the recurring tab)
  const [instructions, setInstructions] = useState<RecurringInstruction[]>([]);

  // Form state — Add Money
  const [addSource,  setAddSource]  = useState<string>("BKASH");
  const [addAmount,  setAddAmount]  = useState<string>("");
  const [addMemo,    setAddMemo]    = useState<string>("");

  // Form state — Cash Out
  const [wDest,      setWDest]      = useState<string>("BKASH");
  const [wAccount,   setWAccount]   = useState<string>("");
  const [wAmount,    setWAmount]    = useState<string>("");
  const [wMemo,      setWMemo]      = useState<string>("");

  // Form state — Merchant Pay
  const [mCode,      setMCode]      = useState<string>("");
  const [mAmount,    setMAmount]    = useState<string>("");
  const [mOrderRef,  setMOrderRef]  = useState<string>("");
  const [mMemo,      setMMemo]      = useState<string>("");

  // Form state — Recurring
  const [rRecipient, setRRecipient] = useState<string>("");
  const [rAmount,    setRAmount]    = useState<string>("");
  const [rCadence,   setRCadence]   = useState<string>("MONTHLY");
  const [rStartAt,   setRStartAt]   = useState<string>(() => {
    const d = new Date(Date.now() + 86_400_000); // tomorrow
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  });
  const [rMemo,      setRMemo]      = useState<string>("");

  // Form state — FX
  const [fxReceiver, setFxReceiver] = useState<string>("");
  const [fxCurrency, setFxCurrency] = useState<string>("USD");
  const [fxAmount,   setFxAmount]   = useState<string>("");

  // ── Data fetches ──────────────────────────────────────────────────────────
  useEffect(() => {
    // Server is the source of truth for the festival calendar (it owns the
    // window parameter). The previous version raced the local hard-coded
    // helper and discarded server results — fixed by trusting the endpoint.
    api<{ festivals: Array<{ key: string; name: string; date: string; dateObj: string; daysAway: number }> }>("/api/festivals/upcoming?days=14")
      .then((d) => setFestivals(
        d.festivals.map((f) => ({
          key: f.key as UpcomingFestival["key"],
          name: f.name,
          date: f.date,
          dateObj: new Date(f.dateObj),
          daysAway: f.daysAway,
        }))
      ))
      .catch(() => setFestivals([]));
    api<{ merchants: Merchant[] }>("/api/merchant")
      .then((d) => setMerchants(d.merchants))
      .catch(() => setMerchants([]));
    api<RecurringInstruction[]>(`/api/recurring/${userId}`)
      .then(setInstructions)
      .catch(() => setInstructions([]));
  }, [userId]);

  // ── Helpers ───────────────────────────────────────────────────────────────
  const others = users.filter((u) => u.id !== userId);

  function parseCents(v: string): number | null {
    const n = parseFloat(v);
    if (!Number.isFinite(n) || n <= 0) return null;
    return Math.round(n * 100);
  }

  async function run(label: string, fn: () => Promise<void>) {
    setBusy(true);
    try { await fn(); } catch (e) {
      onToast("error", e instanceof Error ? e.message : `${label} failed`);
    } finally { setBusy(false); }
  }

  // ── Submit handlers ───────────────────────────────────────────────────────
  function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    const cents = parseCents(addAmount);
    if (cents === null) { onToast("error", "Amount must be a positive number"); return; }
    run("Add Money", async () => {
      await api("/api/funding/add", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": uuid() },
        body: JSON.stringify({ userId, amount: cents, source: addSource, memo: addMemo.trim() || undefined }),
      });
      onToast("success", `Added ${fmtBDT(cents)} via ${addSource}`);
      setAddAmount(""); setAddMemo("");
      await onBalanceRefresh();
    });
  }

  function handleWithdraw(e: React.FormEvent) {
    e.preventDefault();
    const cents = parseCents(wAmount);
    if (cents === null) { onToast("error", "Amount must be a positive number"); return; }
    run("Cash Out", async () => {
      await api("/api/funding/withdraw", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": uuid() },
        body: JSON.stringify({
          userId, amount: cents, destination: wDest,
          accountRef: wAccount.trim() || undefined,
          memo: wMemo.trim() || undefined,
        }),
      });
      onToast("success", `Withdrew ${fmtBDT(cents)} to ${wDest}`);
      setWAmount(""); setWAccount(""); setWMemo("");
      await onBalanceRefresh();
    });
  }

  function handleMerchantPay(e: React.FormEvent) {
    e.preventDefault();
    const cents = parseCents(mAmount);
    if (cents === null) { onToast("error", "Amount must be a positive number"); return; }
    if (!mCode) { onToast("error", "Pick a merchant"); return; }
    run("Merchant Pay", async () => {
      await api("/api/merchant/pay", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": uuid() },
        body: JSON.stringify({
          userId, merchantCode: mCode, amount: cents,
          orderRef: mOrderRef.trim() || undefined,
          memo: mMemo.trim() || undefined,
        }),
      });
      onToast("success", `Paid ${fmtBDT(cents)} to ${merchants.find((x) => x.code === mCode)?.name ?? mCode}`);
      setMAmount(""); setMOrderRef(""); setMMemo("");
      await onBalanceRefresh();
    });
  }

  function handleRecurring(e: React.FormEvent) {
    e.preventDefault();
    const cents = parseCents(rAmount);
    if (cents === null) { onToast("error", "Amount must be a positive number"); return; }
    if (!rRecipient) { onToast("error", "Pick a recipient"); return; }
    const startISO = new Date(rStartAt).toISOString();
    run("Recurring", async () => {
      await api("/api/recurring", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId, recipientId: parseInt(rRecipient), amount: cents,
          cadence: rCadence, startAt: startISO,
          memo: rMemo.trim() || undefined,
          category: "TRANSFER",
        }),
      });
      onToast("success", `Recurring ${rCadence.toLowerCase()} set for ${fmtBDT(cents)}`);
      setRAmount(""); setRMemo("");
      const list = await api<RecurringInstruction[]>(`/api/recurring/${userId}`).catch(() => []);
      setInstructions(list);
    });
  }

  function handleFx(e: React.FormEvent) {
    e.preventDefault();
    const amount = parseFloat(fxAmount);
    if (!Number.isFinite(amount) || amount <= 0) { onToast("error", "Amount must be a positive number"); return; }
    if (!fxReceiver) { onToast("error", "Pick a recipient"); return; }
    run("FX Transfer", async () => {
      await api("/api/fx/transfer", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": uuid() },
        body: JSON.stringify({
          senderId: userId, receiverId: parseInt(fxReceiver),
          amountForeign: amount, currency: fxCurrency,
          memo: undefined,
          category: "FX",
        }),
      });
      onToast("success", `Sent ${amount} ${fxCurrency} (≈ ${fmtBDT(Math.round(amount * FX_PREVIEW[fxCurrency]! * 100))})`);
      setFxAmount("");
      await onBalanceRefresh();
    });
  }

  async function cancelInstruction(id: number) {
    try {
      await api(`/api/recurring/${id}`, { method: "DELETE" });
      setInstructions((prev) => prev.map((i) => i.id === id ? { ...i, active: false } : i));
      onToast("success", "Standing instruction cancelled");
    } catch (e) {
      onToast("error", e instanceof Error ? e.message : "Cancel failed");
    }
  }

  // FX live preview
  const fxPreview = useMemo(() => {
    const n = parseFloat(fxAmount);
    if (!Number.isFinite(n) || n <= 0) return null;
    const rate = FX_PREVIEW[fxCurrency] ?? 1;
    return { rate, bdt: fmtBDT(Math.round(n * rate * 100)) };
  }, [fxAmount, fxCurrency]);

  return (
    <div className="space-y-6">
      {/* Festival strip — only renders when a festival is upcoming */}
      <AnimatePresence>
        {festivals.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className="flex items-center gap-3 rounded-2xl px-5 py-3.5 bg-gradient-to-r from-amber-500/15 to-rose-500/10 border border-amber-400/25"
            role="status"
          >
            <div className="w-9 h-9 rounded-xl bg-amber-400/15 border border-amber-400/30 flex items-center justify-center flex-shrink-0">
              <Gift className="w-4 h-4 text-amber-300" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm text-amber-100 font-semibold">
                {festivals[0]!.name} in {festivals[0]!.daysAway} day{festivals[0]!.daysAway === 1 ? "" : "s"}
              </p>
              <p className="text-xs text-amber-200/70">
                Schedule a festival bonus or sundry to a contact — try the Recurring tab below.
              </p>
            </div>
            <Button
              variant="primary"
              size="sm"
              onClick={() => setFlow("recurring")}
            >
              <CalendarClock className="w-3.5 h-3.5" />
              Schedule bonus
            </Button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Sub-tabs for the 5 flows */}
      <div className="flex overflow-x-auto gap-1 border-b border-[var(--border)] px-1">
        {FLOW_TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setFlow(t.id)}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-t-xl text-xs font-semibold whitespace-nowrap transition-all ${
              flow === t.id
                ? "bg-[var(--muted)] text-[var(--primary)] border-b-2 border-[var(--primary)]"
                : "text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)]/50"
            }`}
          >
            {t.icon}
            {t.label}
          </button>
        ))}
      </div>

      <AnimatePresence mode="wait">
        {/* ── Add Money ─────────────────────────────────────────────────── */}
        {flow === "add" && (
          <motion.form
            key="add"
            variants={fadeUp}
            initial="hidden"
            animate="show"
            exit={{ opacity: 0, y: -8 }}
            onSubmit={handleAdd}
            className="space-y-4"
          >
            <div className="grid sm:grid-cols-2 gap-4">
              <div>
                <Label>Source</Label>
                <Select value={addSource} onChange={(e) => setAddSource(e.target.value)}>
                  {FUNDING_PROVIDERS.map((p) => <option key={p} value={p}>{p}</option>)}
                </Select>
              </div>
              <div>
                <Label>Amount (BDT)</Label>
                <Input
                  type="number" step="0.01" min={1} required
                  value={addAmount}
                  onChange={(e) => setAddAmount(e.target.value)}
                  placeholder="e.g. 5000"
                />
              </div>
            </div>
            <div>
              <Label>Memo (optional)</Label>
              <Input value={addMemo} onChange={(e) => setAddMemo(e.target.value)}
                maxLength={140} placeholder="e.g. Salary top-up" />
            </div>
            <Button type="submit" variant="primary" size="lg" loading={busy}>
              <PlusCircle className="w-4 h-4" />
              Add money
            </Button>
          </motion.form>
        )}

        {/* ── Cash Out ─────────────────────────────────────────────────── */}
        {flow === "withdraw" && (
          <motion.form
            key="withdraw"
            variants={fadeUp}
            initial="hidden"
            animate="show"
            exit={{ opacity: 0, y: -8 }}
            onSubmit={handleWithdraw}
            className="space-y-4"
          >
            <div className="grid sm:grid-cols-2 gap-4">
              <div>
                <Label>Destination</Label>
                <Select value={wDest} onChange={(e) => setWDest(e.target.value)}>
                  {FUNDING_PROVIDERS.map((p) => <option key={p} value={p}>{p}</option>)}
                </Select>
              </div>
              <div>
                <Label>Amount (BDT)</Label>
                <Input
                  type="number" step="0.01" min={1} required
                  value={wAmount}
                  onChange={(e) => setWAmount(e.target.value)}
                  placeholder="e.g. 2000"
                />
              </div>
            </div>
            <div className="grid sm:grid-cols-2 gap-4">
              <div>
                <Label>Account reference (optional)</Label>
                <Input
                  value={wAccount}
                  onChange={(e) => setWAccount(e.target.value)}
                  maxLength={40}
                  placeholder="MFS number / last 4"
                />
              </div>
              <div>
                <Label>Memo (optional)</Label>
                <Input value={wMemo} onChange={(e) => setWMemo(e.target.value)}
                  maxLength={140} placeholder="e.g. Cash for groceries" />
              </div>
            </div>
            <Button type="submit" variant="primary" size="lg" loading={busy}>
              <MinusCircle className="w-4 h-4" />
              Withdraw
            </Button>
          </motion.form>
        )}

        {/* ── Merchant Pay ─────────────────────────────────────────────── */}
        {flow === "merchant" && (
          <motion.form
            key="merchant"
            variants={fadeUp}
            initial="hidden"
            animate="show"
            exit={{ opacity: 0, y: -8 }}
            onSubmit={handleMerchantPay}
            className="space-y-4"
          >
            {merchants.length === 0 ? (
              <EmptyState icon={<ShoppingBag className="w-5 h-5" />} title="No merchants seeded yet" />
            ) : (
              <>
                <div>
                  <Label>Merchant</Label>
                  <div className="flex flex-wrap gap-2">
                    {merchants.map((m) => {
                      const active = mCode === m.code;
                      return (
                        <button
                          key={m.code}
                          type="button"
                          onClick={() => setMCode(m.code)}
                          className={`px-3 py-1.5 rounded-xl text-xs font-semibold border transition-all ${
                            active
                              ? "bg-[var(--primary)] text-[var(--primary-foreground)] border-[var(--primary)]"
                              : "bg-[var(--muted)] text-[var(--muted-foreground)] border-[var(--border)] hover:border-[var(--primary)]/40"
                          }`}
                        >
                          {m.name}
                          {m.mfsProvider && (
                            <span className={`ml-2 text-[10px] ${active ? "opacity-80" : "text-[var(--muted-foreground)]"}`}>
                              · {m.mfsProvider}
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
                <div className="grid sm:grid-cols-2 gap-4">
                  <div>
                    <Label>Amount (BDT)</Label>
                    <Input
                      type="number" step="0.01" min={1} required
                      value={mAmount}
                      onChange={(e) => setMAmount(e.target.value)}
                      placeholder="e.g. 2500"
                    />
                  </div>
                  <div>
                    <Label>Order reference (optional)</Label>
                    <Input
                      value={mOrderRef}
                      onChange={(e) => setMOrderRef(e.target.value)}
                      maxLength={40}
                      placeholder="e.g. INV-2024-001"
                    />
                  </div>
                </div>
                <div>
                  <Label>Memo (optional)</Label>
                  <Input value={mMemo} onChange={(e) => setMMemo(e.target.value)}
                    maxLength={140} placeholder="e.g. Eid shopping" />
                </div>
                <Button type="submit" variant="primary" size="lg" loading={busy} disabled={!mCode}>
                  <ShoppingBag className="w-4 h-4" />
                  Pay merchant
                </Button>
              </>
            )}
          </motion.form>
        )}

        {/* ── Recurring ────────────────────────────────────────────────── */}
        {flow === "recurring" && (
          <motion.div
            key="recurring"
            variants={fadeUp}
            initial="hidden"
            animate="show"
            exit={{ opacity: 0, y: -8 }}
            className="space-y-5"
          >
            <form onSubmit={handleRecurring} className="space-y-4">
              <div className="grid sm:grid-cols-2 gap-4">
                <div>
                  <Label>Recipient</Label>
                  <Select value={rRecipient} onChange={(e) => setRRecipient(e.target.value)} required>
                    <option value="" disabled>Select user</option>
                    {others.map((u) => (
                      <option key={u.id} value={u.id}>{u.name}</option>
                    ))}
                  </Select>
                </div>
                <div>
                  <Label>Amount per leg (BDT)</Label>
                  <Input
                    type="number" step="0.01" min={1} required
                    value={rAmount}
                    onChange={(e) => setRAmount(e.target.value)}
                    placeholder="e.g. 1000"
                  />
                </div>
              </div>
              <div className="grid sm:grid-cols-2 gap-4">
                <div>
                  <Label>Cadence</Label>
                  <Select value={rCadence} onChange={(e) => setRCadence(e.target.value)}>
                    {RECURRING_CADENCES.map((c) => <option key={c} value={c}>{c}</option>)}
                  </Select>
                </div>
                <div>
                  <Label>First run</Label>
                  <Input
                    type="datetime-local"
                    required
                    value={rStartAt}
                    onChange={(e) => setRStartAt(e.target.value)}
                  />
                </div>
              </div>
              <div>
                <Label>Memo (optional)</Label>
                <Input value={rMemo} onChange={(e) => setRMemo(e.target.value)}
                  maxLength={140} placeholder="e.g. Monthly rent" />
              </div>
              <Button type="submit" variant="primary" size="lg" loading={busy}>
                <Repeat className="w-4 h-4" />
                Create instruction
              </Button>
            </form>

            {instructions.length > 0 && (
              <div className="border-t border-[var(--border)] pt-4 space-y-2">
                <p className="text-xs uppercase tracking-widest text-[var(--muted-foreground)] mb-2">
                  Your standing instructions
                </p>
                {instructions.map((i) => (
                  <div key={i.id} className="flex items-center justify-between gap-3 bg-[var(--muted)] border border-[var(--border)] rounded-xl px-4 py-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-[var(--foreground)]">
                        {fmtBDT(i.amount)} → {i.recipient?.name ?? `#${i.recipientId}`}
                      </p>
                      <p className="text-xs text-[var(--muted-foreground)]">
                        {i.cadence.toLowerCase()} · next {new Date(i.nextRunAt).toLocaleDateString("en-GB")}
                      </p>
                    </div>
                    {i.active ? (
                      <Button variant="danger" size="sm" onClick={() => cancelInstruction(i.id)}>
                        Cancel
                      </Button>
                    ) : (
                      <Badge tone="neutral">Cancelled</Badge>
                    )}
                  </div>
                ))}
              </div>
            )}
          </motion.div>
        )}

        {/* ── FX ───────────────────────────────────────────────────────── */}
        {flow === "fx" && (
          <motion.form
            key="fx"
            variants={fadeUp}
            initial="hidden"
            animate="show"
            exit={{ opacity: 0, y: -8 }}
            onSubmit={handleFx}
            className="space-y-4"
          >
            <div className="grid sm:grid-cols-2 gap-4">
              <div>
                <Label>Recipient</Label>
                <Select value={fxReceiver} onChange={(e) => setFxReceiver(e.target.value)} required>
                  <option value="" disabled>Select user</option>
                  {others.map((u) => (
                    <option key={u.id} value={u.id}>{u.name}</option>
                  ))}
                </Select>
              </div>
              <div>
                <Label>Currency</Label>
                <Select value={fxCurrency} onChange={(e) => setFxCurrency(e.target.value)}>
                  {FX_CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </Select>
              </div>
            </div>
            <div>
              <Label>Amount in {fxCurrency}</Label>
              <Input
                type="number" step="0.01" min={0.01} required
                value={fxAmount}
                onChange={(e) => setFxAmount(e.target.value)}
                placeholder={fxCurrency === "INR" ? "e.g. 5000" : "e.g. 100"}
              />
            </div>
            {fxPreview && (
              <div className="bg-cyan-500/8 border border-cyan-400/25 rounded-2xl p-4 text-sm">
                <p className="text-[var(--muted-foreground)] text-xs uppercase tracking-widest mb-1">
                  Receiver will get
                </p>
                <p className="text-2xl font-bold tabular-nums text-cyan-300">
                  {fxPreview.bdt}
                </p>
                <p className="text-xs text-[var(--muted-foreground)] mt-1">
                  Rate: 1 {fxCurrency} = {fxPreview.rate.toFixed(2)} BDT
                </p>
              </div>
            )}
            <Button type="submit" variant="primary" size="lg" loading={busy}>
              <Globe className="w-4 h-4" />
              Send FX
            </Button>
          </motion.form>
        )}
      </AnimatePresence>
    </div>
  );
}
