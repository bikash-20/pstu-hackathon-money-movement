"use client";

/**
 * page.tsx — PSTU Wallet · Main Application Shell
 *
 * Responsibilities:
 *  • User session selection (mock auth)
 *  • Global state: selected user, toast queue, refresh signals
 *  • Layout: header, balance card, action panels, history
 *  • Delegates every feature to its own component
 *
 * Architecture: thin orchestrator — no business logic lives here.
 */

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Wallet,
  Phone,
  Hash,
  Sparkles,
  Loader2,
  ArrowRightLeft,
  HandCoins,
  Users,
  CheckCircle,
  XCircle,
  AlertTriangle,
  X,
  CalendarClock,
  QrCode,
  Target,
  BarChart2,
  PlusCircle,
} from "lucide-react";

import {
  api,
  CATEGORIES,
  fmtBDT,
  LOW_BALANCE_THRESHOLD_CENTS,
  uuid,
} from "./lib";
import type { MoneyRequest, User } from "./types";

// ─── Feature components ───────────────────────────────────────────────────────
import { NotificationPanel }      from "./components/NotificationPanel";
import { SpendingInsights }       from "./components/SpendingInsights";
import { GoalsPanel }             from "./components/GoalsPanel";
import { ScheduledPanel }         from "./components/ScheduledPanel";
import { QRPanel }                from "./components/QRPanel";
import { TransactionHistory }     from "./components/TransactionHistory";
import { ExternalPaymentsPanel }  from "./components/ExternalPaymentsPanel";

// ─── Shared UI atoms ──────────────────────────────────────────────────────────
import {
  Badge,
  Button,
  ConfirmModal,
  ConfirmState,
  GlassCard,
  Input,
  Label,
  Select,
  Skeleton,
  ToastBanner,
  ToastMessage,
  EmptyState,
  fadeUp,
  stagger,
  toastVariants,
} from "./components/ui";

// ─── Tab definition ───────────────────────────────────────────────────────────
type Tab = "send" | "request" | "split" | "scheduled" | "qr" | "external";

const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
  { id: "send",      label: "Send",      icon: <ArrowRightLeft className="w-4 h-4" /> },
  { id: "request",   label: "Request",   icon: <HandCoins      className="w-4 h-4" /> },
  { id: "split",     label: "Split",     icon: <Users          className="w-4 h-4" /> },
  { id: "scheduled", label: "Schedule",  icon: <CalendarClock  className="w-4 h-4" /> },
  { id: "qr",        label: "QR Pay",    icon: <QrCode         className="w-4 h-4" /> },
  { id: "external",  label: "External",  icon: <PlusCircle     className="w-4 h-4" /> },
];

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function Home() {
  // ── State ──────────────────────────────────────────────────────────────────
  const [users,        setUsers]        = useState<User[]>([]);
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [requests,     setRequests]     = useState<MoneyRequest[]>([]);
  const [toasts,       setToasts]       = useState<ToastMessage[]>([]);
  const [tab,          setTab]          = useState<Tab>("send");
  const [txRefresh,    setTxRefresh]    = useState(0);
  const [loading,      setLoading]      = useState(false);
  const [confirm,      setConfirm]      = useState<ConfirmState>(null);
  const [seeding,      setSeeding]      = useState(false);

  // Send form
  const [sendTarget,   setSendTarget]   = useState("");
  const [sendAmount,   setSendAmount]   = useState("");
  const [sendMemo,     setSendMemo]     = useState("");
  const [sendCategory, setSendCategory] = useState("TRANSFER");

  // Request form
  const [reqTarget,    setReqTarget]    = useState("");
  const [reqAmount,    setReqAmount]    = useState("");
  const [reqNote,      setReqNote]      = useState("");

  // Split form
  const [splitIds,     setSplitIds]     = useState<number[]>([]);
  const [splitTotal,   setSplitTotal]   = useState("");
  const [splitMemo,    setSplitMemo]    = useState("");
  const [splitCat,     setSplitCat]     = useState("TRANSFER");

  // ── Refund flow (called from TransactionHistory's inline button)
  async function handleRefund(originalId: number) {
    if (!selectedUser) return;
    try {
      await api("/api/refunds", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": uuid() },
        body: JSON.stringify({ originalId, requesterId: selectedUser.id }),
      });
      toast("success", "Refund issued");
      refreshBalance();
    } catch (err) {
      toast("error", (err as Error).message ?? "Refund failed");
    }
  }

  // ── Toast helpers ──────────────────────────────────────────────────────────
  const toast = useCallback((type: ToastMessage["type"], text: string) => {
    const id = uuid();
    setToasts((prev) => [...prev, { id, type, text }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 4500);
  }, []);

  // ── Data fetchers ──────────────────────────────────────────────────────────
  const fetchUsers = useCallback(async (): Promise<User[]> => {
    try {
      const data = await api<User[]>("/api/users");
      setUsers(data);
      return data;
    } catch {
      return [];
    }
  }, []);

  const fetchRequests = useCallback(async (uid: number) => {
    try {
      const data = await api<MoneyRequest[]>(`/api/requests/${uid}`);
      setRequests(data);
    } catch {
      //
    }
  }, []);

  const refreshBalance = useCallback(async () => {
    const data = await fetchUsers();
    if (selectedUser) {
      const updated = data.find((u) => u.id === selectedUser.id);
      if (updated) setSelectedUser(updated);
    }
    if (selectedUser) fetchRequests(selectedUser.id);
    setTxRefresh((n) => n + 1);
  }, [fetchUsers, fetchRequests, selectedUser]);

  // ── Bootstrap ──────────────────────────────────────────────────────────────
  useEffect(() => {
    // Wake up free-tier hosting
    api("/api/health").catch(() => {});

    fetchUsers().then((data) => {
      if (data.length > 0) setSelectedUser(data[0]);
    });
  }, [fetchUsers]);

  useEffect(() => {
    if (selectedUser) {
      fetchRequests(selectedUser.id);
      setSplitIds([]);
    }
  }, [selectedUser, fetchRequests]);

  // ── Seed handler ───────────────────────────────────────────────────────────
  async function handleSeed() {
    setSeeding(true);
    try {
      const res = await api<{ success: boolean; message: string }>("/api/seed", { method: "POST" });
      toast(res.success ? "success" : "warn", res.message);
      const data = await fetchUsers();
      if (data.length > 0) setSelectedUser(data[0]);
    } catch {
      toast("error", "Seed failed — is the backend running?");
    } finally {
      setSeeding(false);
    }
  }

  // ── Send money ─────────────────────────────────────────────────────────────
  function requestSend(e: React.FormEvent) {
    e.preventDefault();
    const cents = Math.round(parseFloat(sendAmount) * 100);
    if (!selectedUser || !sendTarget || !Number.isFinite(cents) || cents <= 0) return;
    const receiver = users.find((u) => u.id === parseInt(sendTarget));
    setConfirm({
      title:       `Send to ${receiver?.name ?? "recipient"}`,
      description: `${sendMemo.trim() ? `"${sendMemo.trim()}"` : "Funds will be transferred immediately."}`,
      amountLabel: fmtBDT(cents),
      onConfirm:   () => executeSend(parseInt(sendTarget), cents),
    });
  }

  async function executeSend(receiverId: number, cents: number) {
    setLoading(true);
    try {
      await api("/api/transfer", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": uuid() },
        body: JSON.stringify({
          senderId:   selectedUser!.id,
          receiverId,
          amount:     cents,
          memo:       sendMemo.trim() || undefined,
          category:   sendCategory,
        }),
      });
      toast("success", `Sent ${fmtBDT(cents)} successfully`);
      setSendAmount(""); setSendMemo("");
      refreshBalance();
    } catch (err) {
      toast("error", (err as Error).message ?? "Transfer failed");
      throw err; // re-throw so ConfirmModal closes correctly
    } finally {
      setLoading(false);
    }
  }

  // ── Request money ──────────────────────────────────────────────────────────
  async function handleRequest(e: React.FormEvent) {
    e.preventDefault();
    const cents = Math.round(parseFloat(reqAmount) * 100);
    if (!selectedUser || !reqTarget || !Number.isFinite(cents) || cents <= 0) return;
    setLoading(true);
    try {
      await api("/api/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requesterId: selectedUser.id,
          payerId:     parseInt(reqTarget),
          amount:      cents,
          note:        reqNote.trim() || undefined,
        }),
      });
      toast("success", `Requested ${fmtBDT(cents)}`);
      setReqAmount(""); setReqNote("");
    } catch (err) {
      toast("error", (err as Error).message ?? "Request failed");
    } finally {
      setLoading(false);
    }
  }

  // ── Pay a request ──────────────────────────────────────────────────────────
  function requestPay(req: MoneyRequest) {
    setConfirm({
      title:       `Pay ${req.requester.name}`,
      description: req.note ? `Note: "${req.note}"` : "This will settle the pending request.",
      amountLabel: fmtBDT(req.amount),
      onConfirm:   () => executePay(req.id),
    });
  }

  async function executePay(requestId: number) {
    try {
      await api(`/api/request/${requestId}/pay`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": uuid() },
        body: JSON.stringify({ payerId: selectedUser!.id }),
      });
      toast("success", "Request paid!");
      refreshBalance();
    } catch (err) {
      toast("error", (err as Error).message ?? "Payment failed");
      throw err;
    }
  }

  // ── Reject a request ───────────────────────────────────────────────────────
  async function handleReject(requestId: number) {
    try {
      await api(`/api/request/${requestId}/reject`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ payerId: selectedUser!.id }),
      });
      toast("warn", "Request declined");
      setRequests((prev) => prev.filter((r) => r.id !== requestId));
    } catch (err) {
      toast("error", (err as Error).message ?? "Reject failed");
    }
  }

  // ── Split bill ─────────────────────────────────────────────────────────────
  const splitPreview = useMemo(() => {
    const total = parseFloat(splitTotal);
    if (!Number.isFinite(total) || total <= 0 || splitIds.length === 0) return null;
    const cents    = Math.round(total * 100);
    const share    = Math.floor(cents / splitIds.length);
    const rem      = cents - share * splitIds.length;
    return { share, rem, cents };
  }, [splitTotal, splitIds]);

  function requestSplit(e: React.FormEvent) {
    e.preventDefault();
    if (!splitPreview || splitIds.length === 0) return;
    setConfirm({
      title:       `Split ৳${splitTotal} among ${splitIds.length} people`,
      description: "Each person will be charged their share immediately.",
      amountLabel: fmtBDT(splitPreview.cents),
      onConfirm:   () => executeSplit(splitPreview.cents),
    });
  }

  async function executeSplit(totalCents: number) {
    setLoading(true);
    try {
      await api("/api/split", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": uuid() },
        body: JSON.stringify({
          initiatorId:   selectedUser!.id,
          recipientIds:  splitIds,
          totalAmount:   totalCents,
          memo:          splitMemo.trim() || undefined,
          category:      splitCat,
        }),
      });
      toast("success", `Split ${fmtBDT(totalCents)} among ${splitIds.length} people`);
      setSplitIds([]); setSplitTotal(""); setSplitMemo("");
      refreshBalance();
    } catch (err) {
      toast("error", (err as Error).message ?? "Split failed");
      throw err;
    } finally {
      setLoading(false);
    }
  }

  // ── Low balance warning ────────────────────────────────────────────────────
  const lowBalance = selectedUser !== null && selectedUser.balance < LOW_BALANCE_THRESHOLD_CENTS;

  // ── Others list (excludes current user) ───────────────────────────────────
  const others = users.filter((u) => u.id !== selectedUser?.id);

  // ── Loading screen ─────────────────────────────────────────────────────────
  if (users.length === 0) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <div className="glass rounded-3xl p-10 max-w-md w-full text-center space-y-6">
          <div className="mx-auto w-14 h-14 rounded-2xl bg-[var(--primary)]/10 border border-[var(--primary)]/25 flex items-center justify-center">
            <Wallet className="w-7 h-7 text-[var(--primary)]" />
          </div>
          <div>
            <h2 className="text-xl font-semibold text-[var(--foreground)]">Connecting to wallet…</h2>
            <p className="text-[var(--muted-foreground)] text-sm mt-1">
              Waking up the backend. This may take up to 30 s on free-tier hosting.
            </p>
          </div>
          <div className="space-y-2">
            <Skeleton className="h-3 w-3/4 mx-auto" />
            <Skeleton className="h-3 w-1/2 mx-auto" />
          </div>
          <div className="flex items-center justify-center gap-2 text-xs text-[var(--muted-foreground)]">
            <Loader2 className="w-3 h-3 animate-spin" />
            <span>No users found?</span>
            <Button variant="primary" size="sm" loading={seeding} onClick={handleSeed}>
              Seed demo data
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // ── Main layout ─────────────────────────────────────────────────────────────
  return (
    <>
      <ConfirmModal state={confirm} onClose={() => setConfirm(null)} />

      <div className="min-h-screen p-4 md:p-8">
        <div className="max-w-5xl mx-auto space-y-6">

          {/* ── Header ────────────────────────────────────────────────────── */}
          <header className="glass rounded-2xl px-5 py-4 flex justify-between items-center">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-[var(--primary)]/10 border border-[var(--primary)]/25 flex items-center justify-center">
                <Sparkles className="w-5 h-5 text-[var(--primary)]" />
              </div>
              <div>
                <h1 className="text-base font-bold tracking-tight text-[var(--foreground)]">PSTU Wallet</h1>
                <p className="text-[10px] text-[var(--muted-foreground)] uppercase tracking-widest">
                  Money Movement · Hackathon Build
                </p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              {selectedUser && (
                <NotificationPanel userId={selectedUser.id} />
              )}
              <span className="text-[var(--muted-foreground)] text-xs font-medium hidden sm:inline">
                Simulating as
              </span>
              <div className="relative">
                <select
                  aria-label="Select user"
                  className="appearance-none bg-[var(--muted)] border border-[var(--border)] hover:border-[var(--primary)]/40 rounded-xl pl-4 pr-8 py-2 text-sm font-semibold text-[var(--foreground)] outline-none focus:ring-2 focus:ring-[var(--ring)]/40 cursor-pointer transition-colors"
                  value={selectedUser?.id ?? ""}
                  onChange={(e) => {
                    const u = users.find((u) => u.id === parseInt(e.target.value));
                    if (u) setSelectedUser(u);
                  }}
                >
                  {users.map((u) => (
                    <option key={u.id} value={u.id} className="bg-[var(--card)]">
                      {u.name}{u.phone ? ` · ${u.phone}` : ""}
                    </option>
                  ))}
                </select>
                <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[var(--muted-foreground)] text-xs">▾</span>
              </div>
            </div>
          </header>

          {/* ── Toast queue ───────────────────────────────────────────────── */}
          <div className="space-y-2" aria-live="polite">
            <AnimatePresence>
              {toasts.map((t) => <ToastBanner key={t.id} msg={t} />)}
            </AnimatePresence>
          </div>

          {/* ── Low-balance warning ───────────────────────────────────────── */}
          <AnimatePresence>
            {lowBalance && (
              <motion.div
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                className="flex items-center gap-3 bg-amber-500/10 border border-amber-400/30 rounded-2xl px-5 py-3.5"
                role="alert"
              >
                <AlertTriangle className="w-5 h-5 text-amber-400 flex-shrink-0" />
                <p className="text-sm text-amber-200 flex-1">
                  Low balance — only <span className="font-bold tabular-nums">{fmtBDT(selectedUser!.balance)}</span> remaining.
                  Consider topping up via an incoming transfer.
                </p>
              </motion.div>
            )}
          </AnimatePresence>

          {/* ── Balance card + pending requests ───────────────────────────── */}
          <div className="grid md:grid-cols-2 gap-6">

            {/* Balance card */}
            <GlassCard className="relative overflow-hidden">
              <div className="absolute inset-x-0 top-0 h-[2px] brand-stripe" />
              <div className="flex justify-between items-start mb-8">
                <div className="flex items-center gap-2">
                  <Wallet className="w-5 h-5 text-[var(--primary)]" />
                  <p className="text-[var(--muted-foreground)] text-xs font-medium uppercase tracking-widest">
                    Available Balance
                  </p>
                </div>
                <Badge tone="positive">
                  <Sparkles className="w-3 h-3" /> Live
                </Badge>
              </div>

              <h2 className="text-5xl md:text-6xl font-bold tracking-tight tabular-nums text-[var(--foreground)]">
                {selectedUser ? fmtBDT(selectedUser.balance) : "—"}
              </h2>

              <div className="mt-10 pt-6 border-t border-[var(--border)]/50 flex justify-between items-end">
                <div className="space-y-1">
                  <p className="text-[var(--muted-foreground)] text-[10px] uppercase tracking-widest">Account Holder</p>
                  <p className="font-semibold text-lg text-[var(--foreground)]">{selectedUser?.name}</p>
                  {selectedUser?.phone && (
                    <p className="flex items-center gap-1.5 text-[var(--muted-foreground)] text-sm font-mono">
                      <Phone className="w-3 h-3" />{selectedUser.phone}
                    </p>
                  )}
                </div>
                <p className="flex items-center gap-1.5 text-xs font-mono text-[var(--muted-foreground)]">
                  <Hash className="w-3 h-3" />
                  {selectedUser?.id.toString().padStart(6, "0")}
                </p>
              </div>
            </GlassCard>

            {/* Pending requests */}
            <GlassCard>
              <div className="flex justify-between items-center mb-5">
                <div className="flex items-center gap-2">
                  <HandCoins className="w-5 h-5 text-[var(--primary)]" />
                  <h3 className="text-base font-semibold text-[var(--foreground)]">Pending Requests</h3>
                </div>
                <Badge tone={requests.length > 0 ? "warn" : "neutral"}>
                  {requests.length}
                </Badge>
              </div>

              <div className="space-y-3 max-h-72 overflow-y-auto pr-1">
                {requests.length === 0 ? (
                  <EmptyState
                    icon={<HandCoins className="w-5 h-5 text-[var(--muted-foreground)]" />}
                    title="No pending requests"
                  />
                ) : (
                  <motion.ul variants={stagger} initial="hidden" animate="show">
                    <AnimatePresence>
                      {requests.map((req) => (
                        <motion.li
                          key={req.id}
                          variants={fadeUp}
                          exit={{ opacity: 0, x: 20, transition: { duration: 0.2 } }}
                          className="bg-[var(--muted)] border border-[var(--border)] hover:border-[var(--primary)]/30 rounded-2xl p-4 mb-3 last:mb-0 transition-colors"
                        >
                          <div className="flex items-start justify-between mb-3">
                            <div>
                              <p className="font-semibold text-[var(--foreground)] text-sm">
                                {req.requester.name}
                              </p>
                              {req.requester.phone && (
                                <p className="text-[var(--muted-foreground)] text-xs font-mono">
                                  {req.requester.phone}
                                </p>
                              )}
                              {req.note && (
                                <p className="text-[var(--muted-foreground)] text-xs mt-0.5 italic">
                                  "{req.note}"
                                </p>
                              )}
                            </div>
                            <p className="text-[var(--negative)] font-bold tabular-nums text-sm">
                              {fmtBDT(req.amount)}
                            </p>
                          </div>
                          <div className="flex gap-2">
                            <Button
                              variant="primary"
                              size="sm"
                              className="flex-1"
                              onClick={() => requestPay(req)}
                              disabled={loading}
                            >
                              <CheckCircle className="w-3.5 h-3.5" />
                              Pay
                            </Button>
                            <Button
                              variant="danger"
                              size="sm"
                              className="flex-1"
                              onClick={() => handleReject(req.id)}
                            >
                              <XCircle className="w-3.5 h-3.5" />
                              Decline
                            </Button>
                          </div>
                        </motion.li>
                      ))}
                    </AnimatePresence>
                  </motion.ul>
                )}
              </div>
            </GlassCard>
          </div>

          {/* ── Action tabs ────────────────────────────────────────────────── */}
          <GlassCard className="!p-0 overflow-hidden">
            {/* Tab bar */}
            <div className="flex overflow-x-auto border-b border-[var(--border)] px-1 pt-1 gap-1">
              {TABS.map((t) => (
                <button
                  key={t.id}
                  onClick={() => setTab(t.id)}
                  className={`flex items-center gap-2 px-4 py-3 rounded-t-xl text-sm font-semibold whitespace-nowrap transition-all ${
                    tab === t.id
                      ? "bg-[var(--muted)] text-[var(--primary)] border-b-2 border-[var(--primary)]"
                      : "text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)]/50"
                  }`}
                >
                  {t.icon}
                  {t.label}
                </button>
              ))}
            </div>

            <div className="p-6 md:p-8">
              <AnimatePresence mode="wait">
                {/* ── SEND ───────────────────────────────────────────────── */}
                {tab === "send" && (
                  <motion.form
                    key="send"
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -8 }}
                    transition={{ duration: 0.2 }}
                    onSubmit={requestSend}
                    className="space-y-4"
                  >
                    <div className="grid sm:grid-cols-2 gap-4">
                      <div>
                        <Label htmlFor="send-target">Recipient</Label>
                        <Select
                          id="send-target"
                          required
                          value={sendTarget}
                          onChange={(e) => setSendTarget(e.target.value)}
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
                        <Label htmlFor="send-amount">Amount (BDT)</Label>
                        <Input
                          id="send-amount"
                          type="number"
                          step="0.01"
                          min={1}
                          required
                          value={sendAmount}
                          onChange={(e) => setSendAmount(e.target.value)}
                          placeholder="e.g. 500"
                        />
                      </div>
                    </div>
                    <div className="grid sm:grid-cols-2 gap-4">
                      <div>
                        <Label htmlFor="send-cat">Category</Label>
                        <Select
                          id="send-cat"
                          value={sendCategory}
                          onChange={(e) => setSendCategory(e.target.value)}
                        >
                          {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                        </Select>
                      </div>
                      <div>
                        <Label htmlFor="send-memo">Memo (optional)</Label>
                        <Input
                          id="send-memo"
                          type="text"
                          maxLength={140}
                          value={sendMemo}
                          onChange={(e) => setSendMemo(e.target.value)}
                          placeholder="What's this for?"
                        />
                      </div>
                    </div>
                    <Button type="submit" variant="primary" size="lg" loading={loading}>
                      <ArrowRightLeft className="w-4 h-4" />
                      Send Instantly
                    </Button>
                  </motion.form>
                )}

                {/* ── REQUEST ────────────────────────────────────────────── */}
                {tab === "request" && (
                  <motion.form
                    key="request"
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -8 }}
                    transition={{ duration: 0.2 }}
                    onSubmit={handleRequest}
                    className="space-y-4"
                  >
                    <div className="grid sm:grid-cols-2 gap-4">
                      <div>
                        <Label htmlFor="req-target">Request from</Label>
                        <Select
                          id="req-target"
                          required
                          value={reqTarget}
                          onChange={(e) => setReqTarget(e.target.value)}
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
                        <Label htmlFor="req-amount">Amount (BDT)</Label>
                        <Input
                          id="req-amount"
                          type="number"
                          step="0.01"
                          min={1}
                          required
                          value={reqAmount}
                          onChange={(e) => setReqAmount(e.target.value)}
                          placeholder="e.g. 1200"
                        />
                      </div>
                    </div>
                    <div>
                      <Label htmlFor="req-note">Note (optional)</Label>
                      <Input
                        id="req-note"
                        type="text"
                        maxLength={140}
                        value={reqNote}
                        onChange={(e) => setReqNote(e.target.value)}
                        placeholder='e.g. "Dinner last Friday"'
                      />
                    </div>
                    <Button type="submit" variant="primary" size="lg" loading={loading}>
                      <HandCoins className="w-4 h-4" />
                      Send Request
                    </Button>
                    <p className="text-xs text-[var(--muted-foreground)]">
                      Requests expire after 7 days if unpaid.
                    </p>
                  </motion.form>
                )}

                {/* ── SPLIT ──────────────────────────────────────────────── */}
                {tab === "split" && (
                  <motion.form
                    key="split"
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -8 }}
                    transition={{ duration: 0.2 }}
                    onSubmit={requestSplit}
                    className="space-y-5"
                  >
                    <div>
                      <Label>Split with</Label>
                      <div className="flex flex-wrap gap-2">
                        {others.map((u) => {
                          const active = splitIds.includes(u.id);
                          return (
                            <button
                              key={u.id}
                              type="button"
                              onClick={() =>
                                setSplitIds((prev) =>
                                  prev.includes(u.id) ? prev.filter((x) => x !== u.id) : [...prev, u.id]
                                )
                              }
                              className={`px-4 py-2.5 rounded-xl text-sm font-medium border transition-all ${
                                active
                                  ? "bg-[var(--primary)] text-[var(--primary-foreground)] border-[var(--primary)] shadow-lg shadow-[var(--primary)]/20"
                                  : "bg-[var(--muted)] text-[var(--muted-foreground)] border-[var(--border)] hover:border-[var(--primary)]/40 hover:text-[var(--foreground)]"
                              }`}
                            >
                              {u.name}
                              {u.phone && (
                                <span className={`ml-2 text-xs font-mono ${active ? "opacity-70" : "text-[var(--muted-foreground)]"}`}>
                                  {u.phone}
                                </span>
                              )}
                            </button>
                          );
                        })}
                      </div>
                      <p className="text-xs text-[var(--muted-foreground)] mt-2">
                        {splitIds.length === 0 ? "Tap people to include in the split" : `${splitIds.length} selected`}
                      </p>
                    </div>

                    <div className="grid sm:grid-cols-2 gap-4">
                      <div>
                        <Label htmlFor="split-total">Total Amount (BDT)</Label>
                        <Input
                          id="split-total"
                          type="number"
                          step="0.01"
                          min={1}
                          required
                          value={splitTotal}
                          onChange={(e) => setSplitTotal(e.target.value)}
                          placeholder="e.g. 1500"
                        />
                      </div>
                      <div>
                        <Label htmlFor="split-cat">Category</Label>
                        <Select
                          id="split-cat"
                          value={splitCat}
                          onChange={(e) => setSplitCat(e.target.value)}
                        >
                          {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                        </Select>
                      </div>
                    </div>

                    <div>
                      <Label htmlFor="split-memo">Memo (optional)</Label>
                      <Input
                        id="split-memo"
                        type="text"
                        maxLength={140}
                        value={splitMemo}
                        onChange={(e) => setSplitMemo(e.target.value)}
                        placeholder='e.g. "Team lunch"'
                      />
                    </div>

                    {splitPreview && (
                      <div className="bg-[var(--primary)]/8 border border-[var(--primary)]/20 rounded-2xl p-4 text-sm text-[var(--foreground)]">
                        Each person pays{" "}
                        <span className="font-bold tabular-nums text-[var(--primary)]">
                          {fmtBDT(splitPreview.share)}
                        </span>
                        {splitPreview.rem > 0 && (
                          <span className="text-[var(--muted-foreground)]">
                            {" "}(+{splitPreview.rem} paisa remainder to first recipient)
                          </span>
                        )}
                        .
                      </div>
                    )}

                    <Button
                      type="submit"
                      variant="primary"
                      size="lg"
                      loading={loading}
                      disabled={splitIds.length === 0}
                    >
                      <Users className="w-4 h-4" />
                      Split Payment
                    </Button>
                  </motion.form>
                )}

                {/* ── SCHEDULED — delegates to ScheduledPanel ─────────────── */}
                {tab === "scheduled" && selectedUser && (
                  <motion.div
                    key="scheduled"
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -8 }}
                    transition={{ duration: 0.2 }}
                  >
                    <ScheduledPanel
                      userId={selectedUser.id}
                      users={users}
                      onToast={toast}
                      onBalanceRefresh={refreshBalance}
                    />
                  </motion.div>
                )}

                {/* ── QR — delegates to QRPanel ──────────────────────────── */}
                {tab === "qr" && selectedUser && (
                  <motion.div
                    key="qr"
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -8 }}
                    transition={{ duration: 0.2 }}
                  >
                    <QRPanel
                      userId={selectedUser.id}
                      onToast={toast}
                      onBalanceRefresh={refreshBalance}
                    />
                  </motion.div>
                )}

                {/* ── External — delegates to ExternalPaymentsPanel ────── */}
                {tab === "external" && selectedUser && (
                  <motion.div
                    key="external"
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -8 }}
                    transition={{ duration: 0.2 }}
                  >
                    <ExternalPaymentsPanel
                      userId={selectedUser.id}
                      users={users}
                      onToast={toast}
                      onBalanceRefresh={refreshBalance}
                    />
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </GlassCard>

          {/* ── Feature panels (insights, goals) ──────────────────────────── */}
          {selectedUser && (
            <div className="grid md:grid-cols-2 gap-6">
              <SpendingInsights userId={selectedUser.id} />
              <GoalsPanel
                userId={selectedUser.id}
                onToast={toast}
                onBalanceRefresh={refreshBalance}
              />
            </div>
          )}

          {/* ── Transaction history ────────────────────────────────────────── */}
          {selectedUser && (
            <TransactionHistory
              userId={selectedUser.id}
              refreshToken={txRefresh}
              onRefund={handleRefund}
            />
          )}

        </div>
      </div>
    </>
  );
}
