"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowRightLeft, HandCoins, CheckCircle, XCircle, Users, Wallet,
  Bell, PiggyBank, CalendarClock, QrCode, Star, Search,
  Sparkles, TrendingUp, ShieldCheck,
} from "lucide-react";
import { API_URL, CATEGORIES, api, formatCurrency, uuid } from "./lib";

// ---------- Types ----------
type User = { id: number; name: string; balance: number; phone?: string | null };
type MoneyRequest = {
  id: number; amount: number; status: string; note?: string | null;
  createdAt: string; expiresAt?: string;
  requester?: { name: string; phone?: string | null };
  payer?: { name: string; phone?: string | null };
  expired?: boolean;
};
type Tx = {
  id: number; senderId: number; receiverId: number; amount: number;
  status: string; memo?: string | null; category?: string;
  createdAt: string;
  sender: { id: number; name: string; phone?: string | null };
  receiver: { id: number; name: string; phone?: string | null };
};
type Contact = { id: number; ownerId: number; contactId: number; nickname?: string | null; contact?: User | null };
type Goal = { id: number; name: string; targetAmount: number; savedAmount: number; completedAt?: string | null };
type Notif = { id: number; kind: string; title: string; body?: string | null; read: boolean; createdAt: string };
type Insight = { userId: number; days: number; totalOut: number; count: number; breakdown: { category: string; total: number; count: number; pct: number }[] };

// ---------- Motion ----------
const fadeUp = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0, transition: { duration: 0.4, ease: [0.22, 1, 0.36, 1] as const } },
};
const toastAnim = {
  hidden: { opacity: 0, y: -16, scale: 0.98 },
  show: { opacity: 1, y: 0, scale: 1, transition: { duration: 0.3, ease: [0.22, 1, 0.36, 1] as const } },
  exit: { opacity: 0, y: -8, scale: 0.98, transition: { duration: 0.18 } },
};

// ---------- Atoms ----------
function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`shimmer rounded-xl ${className}`} />;
}
function StatBadge({ children, tone = "neutral" }: { children: React.ReactNode; tone?: "neutral" | "positive" | "warn" | "gold" }) {
  const tones = {
    neutral: "bg-indigo-400/10 text-indigo-200 border-indigo-400/25",
    positive: "bg-emerald-400/10 text-emerald-300 border-emerald-400/30",
    warn: "bg-rose-400/10 text-rose-300 border-rose-400/30",
    gold: "bg-amber-400/10 text-amber-300 border-amber-400/30",
  } as const;
  return (
    <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border font-medium ${tones[tone]}`}>{children}</span>
  );
}
function GlassCard({ children, className = "", title, icon, action }: {
  children: React.ReactNode; className?: string; title?: string; icon?: React.ReactNode; action?: React.ReactNode;
}) {
  return (
    <motion.section variants={fadeUp} className={`glass rounded-3xl p-6 md:p-7 ${className}`}>
      {(title || action) && (
        <div className="flex items-center justify-between mb-5">
          <h2 className="flex items-center gap-2 text-base font-semibold text-amber-50">
            <span className="text-amber-400">{icon}</span>{title}
          </h2>
          {action}
        </div>
      )}
      {children}
    </motion.section>
  );
}
const inputCls =
  "w-full bg-[#0B1026]/80 border border-[#2B3560] hover:border-amber-400/40 rounded-xl px-3.5 py-2.5 text-sm text-amber-50 placeholder:text-slate-500 outline-none focus:ring-2 focus:ring-amber-400/40 transition-colors";
const labelCls = "block text-xs font-medium uppercase tracking-wider text-slate-400 mb-1.5";
const btnGold =
  "inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-amber-400 to-yellow-500 px-4 py-2.5 text-sm font-bold text-[#1A1400] hover:brightness-110 active:scale-[0.98] disabled:opacity-50 transition-all shadow-lg shadow-amber-500/20";
const btnGhost =
  "inline-flex items-center justify-center gap-2 rounded-xl border border-[#2B3560] bg-indigo-400/5 px-4 py-2.5 text-sm font-semibold text-indigo-100 hover:border-amber-400/40 transition-colors disabled:opacity-50";
const CAT_COLORS: Record<string, string> = {
  FOOD: "#FB923C", TRANSPORT: "#38BDF8", SHOPPING: "#F472B6", BILLS: "#FACC15",
  EDUCATION: "#818CF8", HEALTH: "#34D399", ENTERTAINMENT: "#C084FC", SAVINGS: "#F2B705",
  TRANSFER: "#94A3B8", OTHER: "#64748B",
};

// ---------- Main state ----------
export default function Home() {
  const [users, setUsers] = useState<User[]>([]);
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [requests, setRequests] = useState<MoneyRequest[]>([]);
  const [requestsOut, setRequestsOut] = useState<MoneyRequest[]>([]);
  const [txs, setTxs] = useState<Tx[]>([]);
  const [txCursor, setTxCursor] = useState<number | null>(null);
  const [txLoading, setTxLoading] = useState(false);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [notifs, setNotifs] = useState<Notif[]>([]);
  const [insights, setInsights] = useState<Insight | null>(null);
  const [scheduled, setScheduled] = useState<Tx[]>([]);

  // filters
  const [direction, setDirection] = useState("all");
  const [category, setCategory] = useState("ALL");
  const [query, setQuery] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [tab, setTab] = useState<"all" | "requests" | "scheduled">("all");

  // forms
  const [sendTargetId, setSendTargetId] = useState("");
  const [sendAmount, setSendAmount] = useState("");
  const [sendMemo, setSendMemo] = useState("");
  const [sendCat, setSendCat] = useState<string>("TRANSFER");
  const [reqTargetId, setReqTargetId] = useState("");
  const [reqAmount, setReqAmount] = useState("");
  const [reqNote, setReqNote] = useState("");
  const [splitIds, setSplitIds] = useState<number[]>([]);
  const [splitTotal, setSplitTotal] = useState("");
  const [schedTarget, setSchedTarget] = useState("");
  const [schedAmount, setSchedAmount] = useState("");
  const [schedWhen, setSchedWhen] = useState("");
  const [qrAmount, setQrAmount] = useState("");
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [qrRedeem, setQrRedeem] = useState("");
  const [goalName, setGoalName] = useState("");
  const [goalTarget, setGoalTarget] = useState("");
  const [goalDeposits, setGoalDeposits] = useState<Record<number, string>>({});

  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetch(`${API_URL}/health`).catch(() => {});
    api<User[]>("/users").then((data) => {
      setUsers(data);
      if (data.length > 0) setSelectedUser((prev) => prev ?? data[0]!);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(query.trim()), 400);
    return () => clearTimeout(t);
  }, [query]);

  const showMessage = useCallback((type: "success" | "error", text: string) => {
    setMessage({ type, text });
    setTimeout(() => setMessage(null), 4200);
  }, []);

  const refreshAll = useCallback(async (uid: number) => {
    try {
      const [u, rin, rout, c, g, n, ins, sch] = await Promise.all([
        api<User[]>("/users"),
        api<MoneyRequest[]>(`/requests/${uid}`),
        api<MoneyRequest[]>(`/requests-out/${uid}`),
        api<Contact[]>(`/contacts/${uid}`),
        api<Goal[]>(`/goals/${uid}`),
        api<Notif[]>(`/notifications/${uid}`),
        api<Insight>(`/insights/${uid}?days=30`),
        api<Tx[]>(`/scheduled/${uid}`).catch(() => [] as Tx[]),
      ]);
      setUsers(u);
      const me = u.find((x) => x.id === uid);
      if (me) setSelectedUser(me);
      setRequests(rin);
      setRequestsOut(rout);
      setContacts(c);
      setGoals(g);
      setNotifs(n);
      setInsights(ins);
      setScheduled(sch);
    } catch { /* keep stale UI on transient failure */ }
  }, []);

  const loadTxs = useCallback(async (uid: number, reset = false, cursor?: number | null) => {
    setTxLoading(true);
    try {
      const params = new URLSearchParams({
        limit: "20", direction,
        ...(category !== "ALL" ? { category } : {}),
        ...(debouncedQ ? { q: debouncedQ } : {}),
        ...(cursor ? { cursor: String(cursor) } : {}),
      });
      const data = await api<{ items: Tx[]; nextCursor: number | null }>(`/transactions/${uid}?${params}`);
      setTxs((prev) => (reset ? data.items : [...prev, ...data.items]));
      setTxCursor(data.nextCursor);
    } catch { if (reset) setTxs([]); } finally { setTxLoading(false); }
  }, [direction, category, debouncedQ]);

  useEffect(() => {
    if (selectedUser) {
      refreshAll(selectedUser.id);
      loadTxs(selectedUser.id, true);
    } else { setTxs([]); setRequests([]); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedUser?.id]);

  useEffect(() => {
    if (selectedUser) loadTxs(selectedUser.id, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [direction, category, debouncedQ]);

  const unread = notifs.filter((n) => !n.read).length;
  const totals = useMemo(() => {
    let inflow = 0, outflow = 0;
    for (const t of txs) {
      if (t.senderId === selectedUser?.id) outflow += t.amount;
      else inflow += t.amount;
    }
    return { inflow, outflow };
  }, [txs, selectedUser?.id]);

  const splitPreview = useMemo(() => {
    const total = parseFloat(splitTotal);
    if (!Number.isFinite(total) || total <= 0 || splitIds.length === 0) return null;
    const totalCents = Math.round(total * 100);
    const share = Math.floor(totalCents / splitIds.length);
    return { share, remainder: totalCents - share * splitIds.length, totalCents };
  }, [splitTotal, splitIds]);

  async function run(_label: string, fn: () => Promise<void>) {
    setLoading(true);
    try { await fn(); }
    catch (e) { showMessage("error", e instanceof Error ? e.message : "Action failed"); }
    finally { setLoading(false); }
  }
  const toCents = (v: string) => Math.round(parseFloat(v) * 100);

  // ---------- Loading state ----------
  if (!selectedUser && users.length === 0) {
    return (
      <div className="min-h-screen flex items-center justify-center p-10">
        <div className="glass rounded-3xl p-10 max-w-md w-full text-center space-y-5">
          <div className="mx-auto w-14 h-14 rounded-2xl bg-amber-400/10 border border-amber-400/30 flex items-center justify-center">
            <Wallet className="w-7 h-7 text-amber-400" />
          </div>
          <h2 className="text-xl font-semibold text-amber-50">Loading wallet</h2>
          <div className="space-y-2"><Skeleton className="h-3 w-3/4 mx-auto" /><Skeleton className="h-3 w-1/2 mx-auto" /></div>
        </div>
      </div>
    );
  }

  // ---------- Handlers (money) ----------
  const handleSend = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedUser || !sendTargetId || !sendAmount) return;
    run("Transfer", async () => {
      await api("/transfer", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": uuid() },
        body: JSON.stringify({
          senderId: selectedUser.id, receiverId: parseInt(sendTargetId),
          amount: toCents(sendAmount), memo: sendMemo.trim() || undefined, category: sendCat,
        }),
      });
      showMessage("success", `Sent ${sendAmount} BDT`);
      setSendAmount(""); setSendMemo("");
      refreshAll(selectedUser.id); loadTxs(selectedUser.id, true);
    });
  };

  const handleRequest = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedUser || !reqTargetId || !reqAmount) return;
    run("Request", async () => {
      await api("/request", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requesterId: selectedUser.id, payerId: parseInt(reqTargetId),
          amount: toCents(reqAmount), note: reqNote.trim() || undefined,
        }),
      });
      showMessage("success", `Requested ${reqAmount} BDT`);
      setReqAmount(""); setReqNote("");
      refreshAll(selectedUser.id);
    });
  };

  const payRequest = (id: number) => {
    if (!selectedUser) return;
    run("Pay", async () => {
      await api(`/request/${id}/pay`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": uuid() },
        body: JSON.stringify({ payerId: selectedUser.id }),
      });
      showMessage("success", "Request paid");
      refreshAll(selectedUser.id); loadTxs(selectedUser.id, true);
    });
  };

  const rejectRequest = (id: number) => {
    if (!selectedUser) return;
    run("Reject", async () => {
      await api(`/request/${id}/reject`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ payerId: selectedUser.id }),
      });
      showMessage("success", "Request declined");
      refreshAll(selectedUser.id);
    });
  };

  const handleSplit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedUser || splitIds.length === 0 || !splitTotal) return;
    run("Split", async () => {
      const data = await api<{ recipientCount: number }>("/split", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": uuid() },
        body: JSON.stringify({
          initiatorId: selectedUser.id, recipientIds: splitIds,
          totalAmount: toCents(splitTotal), category: sendCat,
        }),
      });
      showMessage("success", `Split across ${data.recipientCount} people`);
      setSplitTotal(""); setSplitIds([]);
      refreshAll(selectedUser.id); loadTxs(selectedUser.id, true);
    });
  };

  const handleSchedule = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedUser || !schedTarget || !schedAmount || !schedWhen) return;
    run("Schedule", async () => {
      await api("/scheduled", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": uuid() },
        body: JSON.stringify({
          senderId: selectedUser.id, receiverId: parseInt(schedTarget),
          amount: toCents(schedAmount),
          executeAt: new Date(schedWhen).toISOString(), category: "TRANSFER",
        }),
      });
      showMessage("success", "Payment scheduled");
      setSchedAmount(""); setSchedWhen("");
      refreshAll(selectedUser.id);
    });
  };

  const settleNow = () => {
    run("Settle", async () => {
      const data = await api<{ settled: number; skipped: number }>("/scheduled/settle", { method: "POST" });
      showMessage("success", `Settled ${data.settled}, ${data.skipped} still pending`);
      if (selectedUser) { refreshAll(selectedUser.id); loadTxs(selectedUser.id, true); }
    });
  };

  const issueQR = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedUser || !qrAmount) return;
    run("QR", async () => {
      const data = await api<{ code: string }>("/qr/issue", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ receiverId: selectedUser.id, amount: toCents(qrAmount) }),
      });
      setQrCode(data.code);
      showMessage("success", "Pay-code created — share it with the sender");
    });
  };

  const redeemQR = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedUser || !qrRedeem.trim()) return;
    run("Redeem", async () => {
      await api("/qr/redeem", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": uuid() },
        body: JSON.stringify({ senderId: selectedUser.id, code: qrRedeem.trim() }),
      });
      showMessage("success", "QR payment completed");
      setQrRedeem("");
      refreshAll(selectedUser.id); loadTxs(selectedUser.id, true);
    });
  };

  const saveContact = (contactId: number) => {
    if (!selectedUser) return;
    run("Save", async () => {
      await api("/contacts", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ownerId: selectedUser.id, contactId }),
      });
      showMessage("success", "Payee saved");
      refreshAll(selectedUser.id);
    });
  };

  const createGoal = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedUser || !goalName.trim() || !goalTarget) return;
    run("Goal", async () => {
      await api("/goals", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: selectedUser.id, name: goalName.trim(), targetAmount: toCents(goalTarget) }),
      });
      showMessage("success", `Goal created`);
      setGoalName(""); setGoalTarget("");
      refreshAll(selectedUser.id);
    });
  };

  const depositGoal = (goalId: number) => {
    if (!selectedUser) return;
    const raw = goalDeposits[goalId];
    if (!raw || !Number.isFinite(parseFloat(raw)) || parseFloat(raw) <= 0) {
      showMessage("error", "Enter a valid deposit amount"); return;
    }
    run("Deposit", async () => {
      await api(`/goals/${goalId}/deposit`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": uuid() },
        body: JSON.stringify({ userId: selectedUser.id, amount: toCents(raw) }),
      });
      showMessage("success", "Saved into goal");
      setGoalDeposits((p) => ({ ...p, [goalId]: "" }));
      refreshAll(selectedUser.id); loadTxs(selectedUser.id, true);
    });
  };

  const markAllRead = () => {
    if (!selectedUser) return;
    api(`/notifications/${selectedUser.id}/read-all`, { method: "POST" })
      .then(() => refreshAll(selectedUser.id)).catch(() => {});
  };

  const others = users.filter((u) => u.id !== selectedUser?.id);
  if (!selectedUser) return null;

  return (
    <div className="min-h-screen p-4 md:p-10">
      <motion.div initial="hidden" animate="show" className="max-w-6xl mx-auto space-y-6">
        <header className="glass rounded-2xl px-5 py-4 flex flex-wrap gap-3 justify-between items-center">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-400 to-yellow-600 flex items-center justify-center">
              <Sparkles className="w-5 h-5 text-[#1A1400]" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-amber-50">PSTU Wallet v2</h1>
              <p className="text-xs text-slate-400 flex items-center gap-1">
                <ShieldCheck className="w-3 h-3 text-emerald-400" /> Rate-limited · Idempotent
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button onClick={markAllRead} title="Mark read"
              className="relative w-10 h-10 rounded-xl border border-[#2B3560] flex items-center justify-center hover:border-amber-400/40">
              <Bell className="w-4 h-4 text-amber-200" />
              {unread > 0 && (
                <span className="absolute -top-1.5 -right-1.5 min-w-5 h-5 px-1 rounded-full bg-amber-400 text-[#1A1400] text-[11px] font-bold flex items-center justify-center">{unread}</span>
              )}
            </button>
            <select aria-label="Select user"
              className="bg-[#0B1026] border border-[#2B3560] rounded-xl px-3 py-2 text-amber-50 outline-none cursor-pointer"
              value={selectedUser?.id || ""}
              onChange={(e) => { const u = users.find((x) => x.id === parseInt(e.target.value)); if (u) setSelectedUser(u); }}>
              {users.map((u) => (<option key={u.id} value={u.id} className="bg-slate-900">{u.name}</option>))}
            </select>
          </div>
        </header>
        <AnimatePresence>
          {message && (
            <motion.div key={message.text} variants={toastAnim} initial="hidden" animate="show" exit="exit"
              className={`rounded-2xl px-5 py-3 flex items-center gap-3 border text-sm ${
                message.type === "success" ? "bg-emerald-500/10 border-emerald-400/30 text-emerald-200"
                : "bg-rose-500/10 border-rose-400/30 text-rose-200"}`}>
              {message.type === "success" ? <CheckCircle className="w-5 h-5" /> : <XCircle className="w-5 h-5" />}{message.text}
            </motion.div>
          )}
        </AnimatePresence>
        <motion.div variants={fadeUp} className="glass rounded-3xl overflow-hidden">
          <div className="brand-stripe h-1.5" />
          <div className="p-6 md:p-8 flex flex-wrap items-end justify-between gap-6">
            <div>
              <p className="text-xs uppercase tracking-widest text-slate-400">Balance · {selectedUser?.name}</p>
              <p className="tabular-nums text-4xl md:text-5xl font-bold text-amber-50 mt-2">
                {selectedUser ? formatCurrency(selectedUser.balance) : "—"}
              </p>
            </div>
            <div className="flex gap-2 flex-wrap">
              <StatBadge tone="positive">In {formatCurrency(totals.inflow)}</StatBadge>
              <StatBadge tone="warn">Out {formatCurrency(totals.outflow)}</StatBadge>
            </div>
          </div>
          {insights && insights.breakdown.length > 0 && (
            <div className="px-6 md:px-8 pb-6">
              <div className="flex h-2.5 rounded-full overflow-hidden bg-indigo-950/60">
                {insights.breakdown.slice(0, 6).map((b) => (
                  <div key={b.category} title={`${b.category} ${b.pct}%`} className="h-full"
                    style={{ width: `${b.pct}%`, background: CAT_COLORS[b.category] ?? "#64748B" }} />
                ))}
              </div>
              <div className="flex flex-wrap gap-2 mt-2">
                {insights.breakdown.slice(0, 6).map((b) => (
                  <span key={b.category} className="text-[11px] text-slate-300">{b.category} {b.pct}% · </span>
                ))}
              </div>
            </div>
          )}
        </motion.div>

        <div className="grid md:grid-cols-2 gap-6">
          <GlassCard title="Send money" icon={<ArrowRightLeft className="w-4 h-4" />}>
            <form onSubmit={handleSend} className="space-y-3">
              <div>
                <label className={labelCls}>To</label>
                <select className={inputCls} value={sendTargetId} onChange={(e) => setSendTargetId(e.target.value)} required>
                  <option value="">Choose recipient</option>
                  {others.map((u) => (<option key={u.id} value={u.id}>{u.name}</option>))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className={labelCls}>Amount (BDT)</label>
                  <input className={inputCls} value={sendAmount} onChange={(e) => setSendAmount(e.target.value)} placeholder="500" inputMode="decimal" required /></div>
                <div><label className={labelCls}>Category</label>
                  <select className={inputCls} value={sendCat} onChange={(e) => setSendCat(e.target.value)}>
                    {CATEGORIES.map((c) => (<option key={c} value={c}>{c}</option>))}
                  </select></div>
              </div>
              <div><label className={labelCls}>Memo</label>
                <input className={inputCls} value={sendMemo} onChange={(e) => setSendMemo(e.target.value)} maxLength={140} placeholder="Dinner…" /></div>
              <button className={btnGold} disabled={loading}>Send instantly</button>
            </form>
          </GlassCard>
          <GlassCard title="Request money" icon={<HandCoins className="w-4 h-4" />}>
            <form onSubmit={handleRequest} className="space-y-3">
              <div><label className={labelCls}>From</label>
                <select className={inputCls} value={reqTargetId} onChange={(e) => setReqTargetId(e.target.value)} required>
                  <option value="">Choose payer</option>
                  {others.map((u) => (<option key={u.id} value={u.id}>{u.name}</option>))}
                </select></div>
              <div><label className={labelCls}>Amount (BDT)</label>
                <input className={inputCls} value={reqAmount} onChange={(e) => setReqAmount(e.target.value)} placeholder="1200" inputMode="decimal" required /></div>
              <div><label className={labelCls}>Note</label>
                <input className={inputCls} value={reqNote} onChange={(e) => setReqNote(e.target.value)} maxLength={140} placeholder="Lunch…" /></div>
              <button className={btnGold} disabled={loading}>Send request</button>
            </form>
          </GlassCard>
        </div>

        <div className="grid md:grid-cols-2 gap-6">
          <GlassCard title="Split bill" icon={<Users className="w-4 h-4" />}>
            <form onSubmit={handleSplit} className="space-y-3">
              <div className="flex flex-wrap gap-2">
                {others.map((u) => (
                  <button type="button" key={u.id}
                    onClick={() => setSplitIds((p) => p.includes(u.id) ? p.filter((x) => x !== u.id) : [...p, u.id])}
                    className={`px-3 py-1.5 rounded-full text-xs font-semibold border ${
                      splitIds.includes(u.id) ? "bg-amber-400 text-[#1A1400] border-amber-400" : "border-[#2B3560] text-slate-300"}`}>
                    {u.name}
                  </button>
                ))}
              </div>
              <div><label className={labelCls}>Total (BDT)</label>
                <input className={inputCls} value={splitTotal} onChange={(e) => setSplitTotal(e.target.value)} placeholder="1500" inputMode="decimal" required /></div>
              {splitPreview && (
                <p className="text-xs text-slate-400">{formatCurrency(splitPreview.share)} each{ splitPreview.remainder > 0 ? " + remainder to first" : ""}</p>
              )}
              <button className={btnGold} disabled={loading}>Split payment</button>
            </form>
          </GlassCard>
          <GlassCard title="Schedule + QR" icon={<CalendarClock className="w-4 h-4" />}
            action={<button className={btnGhost} onClick={settleNow} disabled={loading}>Settle due</button>}>
            <form onSubmit={handleSchedule} className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <select className={inputCls} value={schedTarget} onChange={(e) => setSchedTarget(e.target.value)} required>
                  <option value="">To…</option>
                  {others.map((u) => (<option key={u.id} value={u.id}>{u.name}</option>))}
                </select>
                <input className={inputCls} value={schedAmount} onChange={(e) => setSchedAmount(e.target.value)} placeholder="BDT" inputMode="decimal" required />
              </div>
              <input type="datetime-local" className={inputCls} value={schedWhen} onChange={(e) => setSchedWhen(e.target.value)} required />
              <button className={btnGold} disabled={loading}>Schedule</button>
            </form>
            <div className="border-t border-[#2B3560] mt-4 pt-4 space-y-3">
              <form onSubmit={issueQR} className="flex gap-2">
                <input className={inputCls} value={qrAmount} onChange={(e) => setQrAmount(e.target.value)} placeholder="QR amount" inputMode="decimal" required />
                <button className={btnGhost}><QrCode className="w-4 h-4" /> Issue</button>
              </form>
              {qrCode && (<p className="text-xs font-mono break-all bg-[#0B1026] border border-dashed border-amber-400/40 rounded-xl p-3 text-amber-200">{qrCode}</p>)}
              <form onSubmit={redeemQR} className="flex gap-2">
                <input className={inputCls} value={qrRedeem} onChange={(e) => setQrRedeem(e.target.value)} placeholder="Paste pay-code" required />
                <button className={btnGhost}>Pay</button>
              </form>
            </div>
          </GlassCard>
        </div>

        <div className="grid md:grid-cols-2 gap-6">
          <GlassCard title={`Incoming requests (${requests.length})`} icon={<HandCoins className="w-4 h-4" />}>
            {requests.length === 0 ? (<p className="text-sm text-slate-500">No pending requests.</p>) : (
              <div className="space-y-2.5">
                {requests.map((rq) => (
                  <div key={rq.id} className="flex items-center justify-between gap-3 bg-[#0B1026]/60 border border-[#2B3560] rounded-2xl px-4 py-3">
                    <div>
                      <p className="text-sm font-semibold text-amber-50">{rq.requester?.name} · {formatCurrency(rq.amount)}</p>
                      {rq.note && <p className="text-xs text-slate-400">“{rq.note}”</p>}
                    </div>
                    <div className="flex gap-2">
                      <button className={btnGold} onClick={() => payRequest(rq.id)} disabled={loading}>Pay</button>
                      <button className={btnGhost} onClick={() => rejectRequest(rq.id)} disabled={loading}>Decline</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
            {requestsOut.length > 0 && (
              <div className="mt-4 pt-3 border-t border-[#2B3560]">
                <p className="text-xs uppercase tracking-wider text-slate-500 mb-2">My outgoing</p>
                {requestsOut.slice(0, 5).map((rq) => (
                  <p key={rq.id} className="text-xs text-slate-400 py-1">
                    → {rq.payer?.name} · {formatCurrency(rq.amount)} · <StatBadge tone={rq.status === "PENDING" ? "gold" : rq.status === "PAID" ? "positive" : "warn"}>{rq.expired ? "EXPIRED" : rq.status}</StatBadge>
                  </p>
                ))}
              </div>
            )}
          </GlassCard>
          <GlassCard title={`Savings goals (${goals.length})`} icon={<PiggyBank className="w-4 h-4" />}>
            <form onSubmit={createGoal} className="flex gap-2 mb-3">
              <input className={inputCls} value={goalName} onChange={(e) => setGoalName(e.target.value)} placeholder="Goal name" maxLength={60} required />
              <input className={inputCls} value={goalTarget} onChange={(e) => setGoalTarget(e.target.value)} placeholder="BDT" inputMode="decimal" required />
              <button className={btnGold}>Add</button>
            </form>
            {goals.length === 0 ? (<p className="text-sm text-slate-500">No goals yet — earmark savings here.</p>) : (
              <div className="space-y-3">
                {goals.slice(0, 4).map((g) => {
                  const pct = Math.min(100, Math.round((g.savedAmount / Math.max(1, g.targetAmount)) * 100));
                  return (
                    <div key={g.id} className="bg-[#0B1026]/60 border border-[#2B3560] rounded-2xl p-3.5">
                      <div className="flex justify-between text-sm">
                        <span className="font-semibold text-amber-50">{g.name} {g.completedAt ? "🎉" : ""}</span>
                        <span className="tabular-nums text-slate-300">{formatCurrency(g.savedAmount)} / {formatCurrency(g.targetAmount)}</span>
                      </div>
                      <div className="h-2 rounded-full bg-indigo-950 mt-2 overflow-hidden">
                        <div className="h-full bg-gradient-to-r from-amber-400 to-emerald-400" style={{ width: `${pct}%` }} />
                      </div>
                      {!g.completedAt && (
                        <form onSubmit={(e) => { e.preventDefault(); depositGoal(g.id); }} className="flex gap-2 mt-2.5">
                          <input className={inputCls} value={goalDeposits[g.id] ?? ""} onChange={(e) => setGoalDeposits((p) => ({ ...p, [g.id]: e.target.value }))} placeholder="Deposit BDT" inputMode="decimal" />
                          <button className={btnGhost}>Save</button>
                        </form>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </GlassCard>
        </div>

        <GlassCard title="Activity" icon={<ArrowRightLeft className="w-4 h-4" />}
          action={
            <div className="flex gap-1.5">
              {(["all", "requests", "scheduled"] as const).map((t) => (
                <button key={t} onClick={() => setTab(t)}
                  className={`px-2.5 py-1 rounded-lg text-[11px] font-bold uppercase ${tab === t ? "bg-amber-400 text-[#1A1400]" : "text-slate-400"}`}>
                  {t}
                </button>
              ))}
            </div>
          }>
          {tab === "all" && (
            <>
              <div className="flex flex-wrap gap-2 mb-4">
                <div className="relative flex-1 min-w-40">
                  <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                  <input className={`${inputCls} pl-9`} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search memos…" maxLength={60} />
                </div>
                <select className="bg-[#0B1026] border border-[#2B3560] rounded-xl px-3 py-2 text-xs text-amber-50" value={direction} onChange={(e) => setDirection(e.target.value)}>
                  <option value="all">All</option><option value="in">In</option><option value="out">Out</option>
                </select>
                <select className="bg-[#0B1026] border border-[#2B3560] rounded-xl px-3 py-2 text-xs text-amber-50" value={category} onChange={(e) => setCategory(e.target.value)}>
                  <option value="ALL">All cats</option>
                  {CATEGORIES.map((c) => (<option key={c} value={c}>{c}</option>))}
                </select>
              </div>
              {txs.length === 0 ? (<p className="text-sm text-slate-500 text-center py-10">No transactions yet.</p>) : (
                <div className="divide-y divide-[#2B3560]/50">
                  {txs.map((t) => {
                    const out = t.senderId === selectedUser?.id;
                    const cp = out ? t.receiver : t.sender;
                    return (
                      <div key={t.id} className="flex items-center justify-between py-3 gap-3">
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-amber-50 truncate">{out ? "Sent to" : "Got from"} {cp.name}</p>
                          <p className="text-[11px] text-slate-500 truncate">{t.memo ? `"${t.memo}" · ` : ""}{t.category} · {new Date(t.createdAt).toLocaleString()}</p>
                        </div>
                        <p className={`tabular-nums font-bold text-sm ${out ? "text-rose-300" : "text-emerald-300"}`}>
                          {out ? "-" : "+"}{formatCurrency(t.amount)}
                        </p>
                      </div>
                    );
                  })}
                </div>
              )}
              {txCursor && (
                <button className={btnGhost} disabled={txLoading}
                  onClick={() => selectedUser && loadTxs(selectedUser.id, false, txCursor)}>
                  {txLoading ? "Loading…" : "Load more"}
                </button>
              )}
            </>
          )}
          {tab === "requests" && (
            <div className="space-y-2">
              {notifs.length === 0 ? (<p className="text-sm text-slate-500 text-center py-8">Inbox empty.</p>) : (
                notifs.slice(0, 12).map((n) => (
                  <div key={n.id} className={`rounded-2xl border px-4 py-3 ${n.read ? "border-[#2B3560]/60 opacity-60" : "border-amber-400/25"}`}>
                    <p className="text-sm font-semibold text-amber-50">{n.title}</p>
                    {n.body && <p className="text-xs text-slate-400">{n.body}</p>}
                  </div>
                ))
              )}
            </div>
          )}
          {tab === "scheduled" && (
            <div className="space-y-2">
              {scheduled.length === 0 ? (<p className="text-sm text-slate-500 text-center py-8">Nothing scheduled.</p>) : (
                scheduled.map((s) => (
                  <p key={s.id} className="text-sm text-slate-300">{formatCurrency(s.amount)} to {s.receiver.name}</p>
                ))
              )}
              <button className={btnGhost} onClick={settleNow} disabled={loading}>Settle due now</button>
            </div>
          )}
        </GlassCard>

        {contacts.length > 0 && (
          <GlassCard title="Saved payees" icon={<Star className="w-4 h-4" />}>
            <div className="flex flex-wrap gap-2">
              {contacts.map((c) => (
                <button key={c.id} onClick={() => { setSendTargetId(String(c.contactId)); window.scrollTo({ top: 0, behavior: "smooth" }); }}
                  className="px-3 py-1.5 rounded-full text-xs font-semibold border border-[#2B3560] text-amber-100 hover:border-amber-400/50">
                  {c.nickname || c.contact?.name || `#${c.contactId}`}
                </button>
              ))}
            </div>
          </GlassCard>
        )}
        <footer className="text-center text-xs text-slate-600 pb-2">
          PSTU Wallet v2 · Helmet + rate-limit + Zod · Daily cap 200K · Requests expire in 7 days
        </footer>
      </motion.div>
    </div>
  );
}
