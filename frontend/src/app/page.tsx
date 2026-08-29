"use client";

import { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowRightLeft,
  HandCoins,
  CheckCircle,
  XCircle,
  Users,
  Wallet,
  Phone,
  Hash,
  Sparkles,
  Loader2,
} from "lucide-react";

type User = { id: number; name: string; balance: number; phone?: string | null };
type MoneyRequest = { id: number; amount: number; requester: { name: string; phone?: string | null } };
type TransactionRow = {
  id: number;
  senderId: number;
  receiverId: number;
  amount: number;
  status: string;
  createdAt: string;
  sender: { id: number; name: string; phone?: string | null };
  receiver: { id: number; name: string; phone?: string | null };
};

let API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000/api";
if (API_URL.endsWith('/')) API_URL = API_URL.slice(0, -1);
if (!API_URL.endsWith('/api')) API_URL += '/api';

function formatCurrency(cents: number) {
  // Bangladeshi Taka (৳) — Intl has no native locale data for BDT, so we
  // use Intl only for digit grouping (thousands separators, decimal places)
  // and prepend the ৳ symbol explicitly.
  const number = new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(cents / 100);
  return `৳${number}`;
}

// ---------- Framer Motion presets ----------
const fadeUp = {
  hidden: { opacity: 0, y: 12 },
  show:   { opacity: 1, y: 0, transition: { duration: 0.45, ease: [0.22, 1, 0.36, 1] as const } },
};
const stagger = {
  hidden: { opacity: 0 },
  show:   { opacity: 1, transition: { staggerChildren: 0.06, delayChildren: 0.08 } },
};
const toast = {
  hidden: { opacity: 0, y: -16, scale: 0.98 },
  show:   { opacity: 1, y: 0,  scale: 1,    transition: { duration: 0.35, ease: [0.22, 1, 0.36, 1] as const } },
  exit:   { opacity: 0, y: -8, scale: 0.98, transition: { duration: 0.2 } },
};

// ---------- Visual atoms ----------
function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`shimmer rounded-xl ${className}`} />;
}

function StatBadge({ children, tone = "neutral" }: { children: React.ReactNode; tone?: "neutral" | "positive" | "warn" }) {
  const tones = {
    neutral:  "bg-slate-800/60 text-slate-300 border-slate-700",
    positive: "bg-emerald-500/10 text-emerald-300 border-emerald-500/30",
    warn:     "bg-rose-500/10 text-rose-300 border-rose-500/30",
  } as const;
  return (
    <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border font-medium ${tones[tone]}`}>
      {children}
    </span>
  );
}

function GlassCard({
  children,
  className = "",
  delay = 0,
}: {
  children: React.ReactNode;
  className?: string;
  delay?: number;
}) {
  return (
    <div className={`glass glass-hover rounded-3xl p-6 md:p-8 ${className}`}>
      {children}
    </div>
  );
}

// ---------- App ----------
export default function Home() {
  const [users, setUsers] = useState<User[]>([]);
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [requests, setRequests] = useState<MoneyRequest[]>([]);
  const [transactions, setTransactions] = useState<TransactionRow[]>([]);

  // Forms State
  const [sendTargetId, setSendTargetId] = useState("");
  const [sendAmount, setSendAmount] = useState("");
  const [reqTargetId, setReqTargetId] = useState("");
  const [reqAmount, setReqAmount] = useState("");

  // Split Bill State
  const [splitRecipientIds, setSplitRecipientIds] = useState<number[]>([]);
  const [splitTotalAmount, setSplitTotalAmount] = useState("");

  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    // Ping /api/health on mount to wake up the Render free-tier service
    // before any real work is attempted. Fire-and-forget.
    fetch(`${API_URL}/health`).catch(() => {});
    fetchUsers();
  }, []);

  useEffect(() => {
    if (selectedUser) {
      fetchRequests(selectedUser.id);
      fetchTransactions(selectedUser.id);
    } else {
      setRequests([]);
      setTransactions([]);
      setSplitRecipientIds([]);
      setSplitTotalAmount("");
    }
  }, [selectedUser]);

  const fetchUsers = async (): Promise<User[]> => {
    try {
      const res = await fetch(`${API_URL}/users`);
      const data = await res.json();
      setUsers(data);
      if (data.length > 0 && !selectedUser) setSelectedUser(data[0]);
      return data;
    } catch (e) {
      console.error("Failed to fetch users");
      return [];
    }
  };

  const fetchRequests = async (userId: number) => {
    try {
      const res = await fetch(`${API_URL}/requests/${userId}`);
      const data = await res.json();
      setRequests(data);
    } catch (e) {
      console.error("Failed to fetch requests");
    }
  };

  const fetchTransactions = async (userId: number) => {
    try {
      const res = await fetch(`${API_URL}/transactions/${userId}`);
      const data = await res.json();
      setTransactions(data);
    } catch (e) {
      console.error("Failed to fetch transactions");
    }
  };

  const refreshData = async () => {
    const latestUsers = await fetchUsers();
    if (selectedUser) {
      const updated = latestUsers.find(u => u.id === selectedUser.id);
      if (updated) setSelectedUser(updated);
      fetchRequests(selectedUser.id);
      fetchTransactions(selectedUser.id);
    }
  };

  const showMessage = (type: "success" | "error", text: string) => {
    setMessage({ type, text });
    setTimeout(() => setMessage(null), 4000);
  };

  const handleSendMoney = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedUser || !sendTargetId || !sendAmount) return;
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/transfer`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": crypto.randomUUID(),
        },
        body: JSON.stringify({
          senderId: selectedUser.id,
          receiverId: parseInt(sendTargetId),
          amount: Math.round(parseFloat(sendAmount) * 100),
        }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        showMessage("success", `Successfully sent ${sendAmount} BDT`);
        setSendAmount("");
        refreshData();
      } else {
        showMessage("error", data.error || "Transfer failed");
      }
    } catch (e) {
      showMessage("error", "Network error");
    } finally {
      setLoading(false);
    }
  };

  const handleRequestMoney = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedUser || !reqTargetId || !reqAmount) return;
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/request`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requesterId: selectedUser.id,
          payerId: parseInt(reqTargetId),
          amount: Math.round(parseFloat(reqAmount) * 100),
        }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        showMessage("success", `Requested ${reqAmount} BDT successfully`);
        setReqAmount("");
      } else {
        showMessage("error", data.error || "Request failed");
      }
    } catch (e) {
      showMessage("error", "Network error");
    } finally {
      setLoading(false);
    }
  };

  const handlePayRequest = async (requestId: number) => {
    if (!selectedUser) return;
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/request/${requestId}/pay`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": crypto.randomUUID(),
        },
        body: JSON.stringify({ payerId: selectedUser.id }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        showMessage("success", "Request paid successfully");
        refreshData();
      } else {
        showMessage("error", data.error || "Payment failed");
      }
    } catch (e) {
      showMessage("error", "Network error");
    } finally {
      setLoading(false);
    }
  };

  const toggleSplitRecipient = (id: number) => {
    setSplitRecipientIds(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    );
  };

  const splitPreview = useMemo(() => {
    const total = parseFloat(splitTotalAmount);
    if (!Number.isFinite(total) || total <= 0) return null;
    const totalCents = Math.round(total * 100);
    const n = splitRecipientIds.length;
    if (n === 0) return null;
    const share = Math.floor(totalCents / n);
    const remainder = totalCents - share * n;
    return { share, remainder, totalCents, n };
  }, [splitTotalAmount, splitRecipientIds]);

  const handleSplitBill = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedUser) return;
    if (splitRecipientIds.length === 0) {
      showMessage("error", "Pick at least one recipient to split with");
      return;
    }
    const total = parseFloat(splitTotalAmount);
    if (!Number.isFinite(total) || total <= 0) {
      showMessage("error", "Enter a valid total amount");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/split`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": crypto.randomUUID(),
        },
        body: JSON.stringify({
          initiatorId: selectedUser.id,
          recipientIds: splitRecipientIds,
          totalAmount: Math.round(total * 100),
        }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        showMessage("success", `Split ${total} BDT across ${splitRecipientIds.length} people`);
        setSplitTotalAmount("");
        setSplitRecipientIds([]);
        refreshData();
      } else {
        showMessage("error", data.error || "Split failed");
      }
    } catch (e) {
      showMessage("error", "Network error");
    } finally {
      setLoading(false);
    }
  };

  // ---------- Loading & empty states ----------
  if (!selectedUser && users.length === 0) {
    return (
      <div className="min-h-screen flex items-center justify-center p-10">
        <div className="glass rounded-3xl p-10 max-w-md w-full text-center space-y-5">
          <div className="mx-auto w-14 h-14 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center">
            <Wallet className="w-7 h-7 text-emerald-400" />
          </div>
          <div>
            <h2 className="text-xl font-semibold text-white">Loading wallet</h2>
            <p className="text-slate-400 text-sm mt-1">Connecting to the secure ledger…</p>
          </div>
          <div className="space-y-2">
            <Skeleton className="h-3 w-3/4 mx-auto" />
            <Skeleton className="h-3 w-1/2 mx-auto" />
          </div>
          <div className="flex items-center justify-center gap-2 text-xs text-slate-500">
            <Loader2 className="w-3 h-3 animate-spin" />
            <span>If this takes more than 30s, run the backend seed endpoint.</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen font-sans p-6 md:p-12">
      <div className="max-w-5xl mx-auto space-y-8">
        {/* ---------- Header / Mock Auth ---------- */}
        <header className="glass rounded-2xl px-6 py-5 flex justify-between items-center">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center">
              <Sparkles className="w-5 h-5 text-emerald-400" />
            </div>
            <div>
              <h1 className="text-lg font-semibold tracking-tight text-slate-100">PSTU Wallet</h1>
              <p className="text-xs text-slate-400">Money Movement · Hackathon Build</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-slate-400 text-xs font-medium uppercase tracking-wider hidden sm:inline">
              Simulating As
            </span>
            <div className="relative">
              <select
                aria-label="Select user"
                className="appearance-none bg-slate-800/60 border border-slate-700 hover:border-emerald-500/50 rounded-xl pl-4 pr-9 py-2 font-semibold text-slate-100 outline-none focus:ring-2 focus:ring-emerald-500/40 cursor-pointer transition-colors"
                value={selectedUser?.id || ""}
                onChange={(e) => {
                  const u = users.find(u => u.id === parseInt(e.target.value));
                  if (u) setSelectedUser(u);
                }}
              >
                {users.map(u => (
                  <option key={u.id} value={u.id} className="bg-slate-900">
                    {u.name}{u.phone ? ` · ${u.phone}` : ''}
                  </option>
                ))}
              </select>
              <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-400">▾</span>
            </div>
          </div>
        </header>

        {/* ---------- Toast ---------- */}
        <AnimatePresence>
          {message && (
            <motion.div
              key={message.text}
              variants={toast}
              initial="hidden"
              animate="show"
              exit="exit"
              className={`rounded-2xl px-5 py-4 flex items-center gap-3 text-white font-medium shadow-lg border ${
                message.type === 'success'
                  ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-100'
                  : 'bg-rose-500/15 border-rose-500/40 text-rose-100'
              }`}
              role="status"
              aria-live="polite"
            >
              {message.type === 'success' ? <CheckCircle className="w-5 h-5" /> : <XCircle className="w-5 h-5" />}
              {message.text}
            </motion.div>
          )}
        </AnimatePresence>

        {/* ---------- Top row: Balance + Pending Requests ---------- */}
        <div className="grid md:grid-cols-2 gap-6">
          {/* Balance Card */}
          <GlassCard className="relative overflow-hidden" delay={0}>
            <div className="absolute inset-x-0 top-0 h-[2px] brand-stripe" />
            <div className="flex justify-between items-start mb-8">
              <div className="flex items-center gap-2">
                <Wallet className="w-5 h-5 text-emerald-400" />
                <p className="text-slate-400 text-sm font-medium uppercase tracking-wider">Available Balance</p>
              </div>
              <StatBadge tone="positive">
                <Sparkles className="w-3 h-3" /> Live
              </StatBadge>
            </div>
            <h2
              key={selectedUser?.balance}
              className="text-5xl md:text-6xl font-bold tracking-tight tabular-nums text-white"
            >
              {selectedUser ? formatCurrency(selectedUser.balance) : "---"}
            </h2>
            <div className="mt-10 pt-6 border-t border-slate-700/50 flex justify-between items-end">
              <div className="space-y-1">
                <p className="text-slate-500 text-xs uppercase tracking-wider">Account Holder</p>
                <p className="font-semibold text-lg text-slate-100">{selectedUser?.name}</p>
                {selectedUser?.phone && (
                  <p className="flex items-center gap-1.5 text-slate-400 text-sm font-mono">
                    <Phone className="w-3 h-3" />
                    {selectedUser.phone}
                  </p>
                )}
              </div>
              <p className="flex items-center gap-1.5 text-xs font-mono text-slate-500">
                <Hash className="w-3 h-3" />
                {selectedUser?.id.toString().padStart(6, '0')}
              </p>
            </div>
          </GlassCard>

          {/* Pending Requests */}
          <GlassCard>
            <div className="flex justify-between items-center mb-5">
              <h3 className="text-lg font-semibold text-slate-100">Pending Requests</h3>
              <StatBadge tone={requests.length > 0 ? "warn" : "neutral"}>
                {requests.length}
              </StatBadge>
            </div>
            <div className="space-y-3 max-h-72 overflow-y-auto pr-1">
              {requests.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <div className="w-12 h-12 rounded-2xl bg-slate-800/60 border border-slate-700 flex items-center justify-center mb-3">
                    <HandCoins className="w-5 h-5 text-slate-500" />
                  </div>
                  <p className="text-slate-500 text-sm italic">No pending requests</p>
                </div>
              ) : (
                <AnimatePresence initial={false}>
                  {requests.map(req => (
                    <div
                      key={req.id}
                      className="bg-slate-800/40 border border-slate-700/60 hover:border-emerald-500/40 rounded-2xl p-4 flex justify-between items-center transition-colors"
                    >
                      <div className="space-y-0.5">
                        <p className="font-semibold text-slate-100">{req.requester.name}</p>
                        {req.requester.phone && (
                          <p className="text-slate-500 text-xs font-mono">{req.requester.phone}</p>
                        )}
                        <p className="text-rose-400 font-bold tabular-nums mt-1">{formatCurrency(req.amount)}</p>
                      </div>
                      <button
                        disabled={loading}
                        onClick={() => handlePayRequest(req.id)}
                        className="bg-emerald-500 hover:bg-emerald-400 text-slate-950 px-5 py-2 rounded-xl text-sm font-semibold transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-emerald-500/10"
                      >
                        Pay
                      </button>
                    </div>
                  ))}
                </AnimatePresence>
              )}
            </div>
          </GlassCard>
        </div>

        {/* ---------- Send / Request ---------- */}
        <div className="grid md:grid-cols-2 gap-6">
          <GlassCard>
            <div className="flex items-center gap-2 mb-6">
              <div className="w-9 h-9 rounded-xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center">
                <ArrowRightLeft className="w-4 h-4 text-emerald-400" />
              </div>
              <h3 className="text-lg font-semibold text-slate-100">Send Money</h3>
            </div>
            <form onSubmit={handleSendMoney} className="space-y-4">
              <div>
                <label className="block text-xs uppercase tracking-wider text-slate-400 mb-2">Recipient</label>
                <select
                  required
                  value={sendTargetId}
                  onChange={e => setSendTargetId(e.target.value)}
                  className="w-full bg-slate-900/60 border border-slate-700 rounded-xl px-4 py-3 outline-none focus:ring-2 focus:ring-emerald-500/40 focus:border-emerald-500/50 transition-colors cursor-pointer"
                >
                  <option value="" disabled>Select a user</option>
                  {users.filter(u => u.id !== selectedUser?.id).map(u => (
                    <option key={u.id} value={u.id} className="bg-slate-900">
                      {u.name}{u.phone ? ` · ${u.phone}` : ''}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs uppercase tracking-wider text-slate-400 mb-2">Amount (BDT)</label>
                <input
                  type="number" step="0.01" min="1" required
                  value={sendAmount} onChange={e => setSendAmount(e.target.value)}
                  className="w-full bg-slate-900/60 border border-slate-700 rounded-xl px-4 py-3 outline-none focus:ring-2 focus:ring-emerald-500/40 focus:border-emerald-500/50 transition-colors tabular-nums"
                  placeholder="e.g. 500"
                />
              </div>
              <button
                disabled={loading}
                className="w-full bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-semibold py-3 rounded-xl transition-all shadow-lg shadow-emerald-500/20 hover:shadow-emerald-500/30 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowRightLeft className="w-4 h-4" />}
                Send Instantly
              </button>
            </form>
          </GlassCard>

          <GlassCard>
            <div className="flex items-center gap-2 mb-6">
              <div className="w-9 h-9 rounded-xl bg-sky-500/15 border border-sky-500/30 flex items-center justify-center">
                <HandCoins className="w-4 h-4 text-sky-400" />
              </div>
              <h3 className="text-lg font-semibold text-slate-100">Request Money</h3>
            </div>
            <form onSubmit={handleRequestMoney} className="space-y-4">
              <div>
                <label className="block text-xs uppercase tracking-wider text-slate-400 mb-2">From</label>
                <select
                  required
                  value={reqTargetId}
                  onChange={e => setReqTargetId(e.target.value)}
                  className="w-full bg-slate-900/60 border border-slate-700 rounded-xl px-4 py-3 outline-none focus:ring-2 focus:ring-sky-500/40 focus:border-sky-500/50 transition-colors cursor-pointer"
                >
                  <option value="" disabled>Select a user</option>
                  {users.filter(u => u.id !== selectedUser?.id).map(u => (
                    <option key={u.id} value={u.id} className="bg-slate-900">
                      {u.name}{u.phone ? ` · ${u.phone}` : ''}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs uppercase tracking-wider text-slate-400 mb-2">Amount (BDT)</label>
                <input
                  type="number" step="0.01" min="1" required
                  value={reqAmount} onChange={e => setReqAmount(e.target.value)}
                  className="w-full bg-slate-900/60 border border-slate-700 rounded-xl px-4 py-3 outline-none focus:ring-2 focus:ring-sky-500/40 focus:border-sky-500/50 transition-colors tabular-nums"
                  placeholder="e.g. 1000"
                />
              </div>
              <button
                disabled={loading}
                className="w-full bg-sky-500 hover:bg-sky-400 text-slate-950 font-semibold py-3 rounded-xl transition-all shadow-lg shadow-sky-500/20 hover:shadow-sky-500/30 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <HandCoins className="w-4 h-4" />}
                Send Request
              </button>
            </form>
          </GlassCard>
        </div>

        {/* ---------- Split Bill ---------- */}
        <GlassCard className="md:col-span-2">
          <div className="flex items-center gap-2 mb-6">
            <div className="w-9 h-9 rounded-xl bg-violet-500/15 border border-violet-500/30 flex items-center justify-center">
              <Users className="w-4 h-4 text-violet-400" />
            </div>
            <h3 className="text-lg font-semibold text-slate-100">Split Bill</h3>
            <span className="text-slate-500 text-xs ml-2">Even-split across multiple recipients · single atomic transaction</span>
          </div>
          <form onSubmit={handleSplitBill} className="space-y-5">
            <div>
              <label className="block text-xs uppercase tracking-wider text-slate-400 mb-3">Split with</label>
              <div className="flex flex-wrap gap-2">
                {users.filter(u => u.id !== selectedUser?.id).map(u => {
                  const active = splitRecipientIds.includes(u.id);
                  return (
                    <button
                      key={u.id}
                      type="button"
                      onClick={() => toggleSplitRecipient(u.id)}
                      title={u.phone || undefined}
                      className={`px-4 py-2.5 rounded-xl text-sm font-medium border transition-colors ${
                        active
                          ? 'bg-violet-500 text-slate-950 border-violet-400 shadow-lg shadow-violet-500/30'
                          : 'bg-slate-800/40 text-slate-300 border-slate-700 hover:border-violet-500/50 hover:text-slate-100'
                      }`}
                    >
                      {u.name}
                      {u.phone && (
                        <span className={`ml-2 text-xs font-mono ${active ? 'text-slate-950/70' : 'text-slate-500'}`}>
                          {u.phone}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
              <p className="text-xs text-slate-500 mt-3">
                {splitRecipientIds.length === 0
                  ? 'Tap one or more people to include in the split.'
                  : `${splitRecipientIds.length} selected`}
              </p>
            </div>
            <div>
              <label className="block text-xs uppercase tracking-wider text-slate-400 mb-2">Total amount (BDT)</label>
              <input
                type="number" step="0.01" min="1" required
                value={splitTotalAmount}
                onChange={e => setSplitTotalAmount(e.target.value)}
                className="w-full bg-slate-900/60 border border-slate-700 rounded-xl px-4 py-3 outline-none focus:ring-2 focus:ring-violet-500/40 focus:border-violet-500/50 transition-colors tabular-nums"
                placeholder="e.g. 1500"
              />
            </div>
            {splitPreview && (
              <div className="bg-violet-500/10 border border-violet-500/30 rounded-xl p-4 text-sm text-violet-100">
                Each person owes <span className="font-bold tabular-nums">{formatCurrency(splitPreview.share)}</span>
                {splitPreview.remainder > 0 && (
                  <> ({splitPreview.remainder} extra cent{splitPreview.remainder === 1 ? '' : 's'} go to the first recipient so the ledger stays balanced)</>
                )}.
              </div>
            )}
            <button
              disabled={loading || splitRecipientIds.length === 0}
              className="w-full bg-violet-500 hover:bg-violet-400 text-slate-950 font-semibold py-3 rounded-xl transition-all shadow-lg shadow-violet-500/20 hover:shadow-violet-500/30 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Users className="w-4 h-4" />}
              Split Payment
            </button>
          </form>
        </GlassCard>

        {/* ---------- Recent Activity ---------- */}
        <GlassCard>
          <div className="flex justify-between items-center mb-6">
            <div className="flex items-center gap-2">
              <h3 className="text-lg font-semibold text-slate-100">Recent Activity</h3>
              <StatBadge tone="neutral">{transactions.length}</StatBadge>
            </div>
            {transactions.length > 0 && (
              <span className="text-xs text-slate-500">Most recent first</span>
            )}
          </div>
          {transactions.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-14 text-center">
              <div className="w-12 h-12 rounded-2xl bg-slate-800/60 border border-slate-700 flex items-center justify-center mb-3">
                <ArrowRightLeft className="w-5 h-5 text-slate-500" />
              </div>
              <p className="text-slate-500 text-sm">No transactions yet</p>
              <p className="text-slate-600 text-xs mt-1">Send money or split a bill to see activity here.</p>
            </div>
          ) : (
            <div className="divide-y divide-slate-700/40">
              <AnimatePresence initial={false}>
                {transactions.map((tx, i) => {
                  const outgoing = tx.senderId === selectedUser?.id;
                  const counterparty = outgoing ? tx.receiver : tx.sender;
                  const sign = outgoing ? '-' : '+';
                  const color = outgoing ? 'text-rose-400' : 'text-emerald-400';
                  const arrow = outgoing ? '→' : '←';
                  return (
                    <div
                      key={tx.id}
                      className="flex items-center justify-between py-3.5 first:pt-0 last:pb-0"
                    >
                      <div className="flex items-center gap-4 min-w-0">
                        <div className={`w-9 h-9 rounded-xl flex items-center justify-center font-mono text-sm flex-shrink-0 ${
                          outgoing
                            ? 'bg-rose-500/10 text-rose-400 border border-rose-500/20'
                            : 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                        }`}>
                          {arrow}
                        </div>
                        <div className="min-w-0">
                          <p className="font-semibold text-slate-100 truncate">
                            {outgoing ? 'Sent to' : 'Received from'} {counterparty.name}
                          </p>
                          <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                            {counterparty.phone && (
                              <span className="text-xs text-slate-500 font-mono">{counterparty.phone}</span>
                            )}
                            <span className="text-xs text-slate-600">·</span>
                            <span className="text-xs text-slate-500">
                              {new Date(tx.createdAt).toLocaleString('en-BD')}
                            </span>
                            <span className="text-xs text-slate-600">·</span>
                            <StatBadge tone={tx.status === 'COMPLETED' ? 'positive' : 'warn'}>
                              {tx.status}
                            </StatBadge>
                          </div>
                        </div>
                      </div>
                      <p className={`font-bold tabular-nums text-base ${color}`}>
                        {sign}{formatCurrency(tx.amount)}
                      </p>
                    </div>
                  );
                })}
              </AnimatePresence>
            </div>
          )}
        </GlassCard>

        <footer className="text-center text-xs text-slate-600 pt-4 pb-2">
          PSTU IT Carnival 2026 · Free-tier stack · Vercel + Render + Neon/Postgres
        </footer>
      </div>
    </div>
  );
}