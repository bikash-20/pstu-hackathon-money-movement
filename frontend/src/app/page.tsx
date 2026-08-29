"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowRightLeft, HandCoins, CheckCircle, XCircle, Users } from "lucide-react";

type User = { id: number; name: string; balance: number };
type MoneyRequest = { id: number; amount: number; requester: { name: string } };
type TransactionRow = {
  id: number;
  senderId: number;
  receiverId: number;
  amount: number;
  status: string;
  createdAt: string;
  sender: { id: number; name: string };
  receiver: { id: number; name: string };
};

let API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000/api";
if (API_URL.endsWith('/')) API_URL = API_URL.slice(0, -1);
if (!API_URL.endsWith('/api')) API_URL += '/api';

function formatCurrency(cents: number) {
  // Intl.NumberFormat with currency: "BDT" falls back to the literal
  // "BDT" prefix in most browsers because there is no native locale data
  // for Bangladeshi Taka. The problem statement uses ৳, so we keep the
  // Intl formatter only for digit grouping (thousands separators, locale-
  // correct decimals) and prepend the ৳ symbol explicitly.
  const number = new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(cents / 100);
  return `৳${number}`;
}

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
    // before any real work is attempted. Fire-and-forget: failure here
    // just means we'll retry when fetchUsers() runs a moment later.
    fetch(`${API_URL}/health`).catch(() => {});
    fetchUsers();
  }, []);

  useEffect(() => {
    if (selectedUser) {
      fetchRequests(selectedUser.id);
      fetchTransactions(selectedUser.id);
    } else {
      // Clear per-user state when no user is selected so a stale
      // selection doesn't leak into a fresh session.
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
          "Idempotency-Key": crypto.randomUUID(), // Prevent double spending on network retry
        },
        body: JSON.stringify({
          senderId: selectedUser.id,
          receiverId: parseInt(sendTargetId),
          amount: Math.round(parseFloat(sendAmount) * 100), // Convert to cents
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

  // Even-split cents preview; mirrors backend remainder rule.
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

  if (!selectedUser && users.length === 0) return <div className="p-10 text-center">Loading or No Users Found (Run DB Seed)...</div>;

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900 font-sans p-6 md:p-12">
      <div className="max-w-4xl mx-auto space-y-8">
        
        {/* Header / Mock Auth */}
        <header className="flex justify-between items-center bg-white p-6 rounded-2xl shadow-sm">
          <h1 className="text-2xl font-bold text-emerald-600 flex items-center gap-2">
            <HandCoins size={28} /> PSTU Wallet
          </h1>
          <div className="flex items-center gap-4">
            <span className="text-gray-500 text-sm font-medium uppercase tracking-wider">Simulating As:</span>
            <select 
              className="bg-gray-100 border-none rounded-lg px-4 py-2 font-semibold text-gray-700 outline-none focus:ring-2 focus:ring-emerald-500"
              value={selectedUser?.id || ""}
              onChange={(e) => {
                const u = users.find(u => u.id === parseInt(e.target.value));
                if (u) setSelectedUser(u);
              }}
            >
              {users.map(u => (
                <option key={u.id} value={u.id}>{u.name}</option>
              ))}
            </select>
          </div>
        </header>

        {message && (
          <div className={`p-4 rounded-xl flex items-center gap-3 text-white font-medium shadow-lg transition-all animate-in fade-in slide-in-from-top-4 ${message.type === 'success' ? 'bg-emerald-500' : 'bg-red-500'}`}>
            {message.type === 'success' ? <CheckCircle /> : <XCircle />}
            {message.text}
          </div>
        )}

        <div className="grid md:grid-cols-2 gap-8">
          
          {/* Dashboard / Balance */}
          <div className="bg-emerald-600 text-white p-8 rounded-3xl shadow-xl flex flex-col justify-between relative overflow-hidden">
            <div className="absolute top-0 right-0 p-8 opacity-10">
              <HandCoins size={120} />
            </div>
            <div>
              <p className="text-emerald-100 font-medium mb-1">Available Balance</p>
              <h2 className="text-5xl font-extrabold tracking-tight">
                {selectedUser ? formatCurrency(selectedUser.balance) : "---"}
              </h2>
            </div>
            <div className="mt-12 flex justify-between items-end">
              <div>
                <p className="text-emerald-100 text-sm">Account Holder</p>
                <p className="font-semibold text-lg">{selectedUser?.name}</p>
              </div>
              <p className="text-sm font-mono opacity-80">ID: {selectedUser?.id.toString().padStart(6, '0')}</p>
            </div>
          </div>

          {/* Pending Requests */}
          <div className="bg-white p-8 rounded-3xl shadow-sm border border-gray-100 flex flex-col">
            <h3 className="text-xl font-bold mb-4 flex items-center gap-2">Pending Requests <span className="bg-rose-100 text-rose-600 text-xs px-2 py-1 rounded-full">{requests.length}</span></h3>
            <div className="flex-1 overflow-y-auto pr-2 space-y-3">
              {requests.length === 0 ? (
                <p className="text-gray-400 text-sm italic text-center mt-10">No pending requests.</p>
              ) : (
                requests.map(req => (
                  <div key={req.id} className="bg-gray-50 border border-gray-200 p-4 rounded-2xl flex justify-between items-center">
                    <div>
                      <p className="font-semibold text-gray-800">{req.requester.name}</p>
                      <p className="text-rose-600 font-bold">{formatCurrency(req.amount)}</p>
                    </div>
                    <button 
                      disabled={loading}
                      onClick={() => handlePayRequest(req.id)}
                      className="bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-xl text-sm font-medium transition-colors disabled:opacity-50"
                    >
                      Pay
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Send Money */}
          <div className="bg-white p-8 rounded-3xl shadow-sm border border-gray-100">
            <h3 className="text-xl font-bold mb-6 flex items-center gap-2">
              <ArrowRightLeft size={20} className="text-emerald-500" /> Send Money
            </h3>
            <form onSubmit={handleSendMoney} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Recipient</label>
                <select 
                  required
                  value={sendTargetId}
                  onChange={e => setSendTargetId(e.target.value)}
                  className="w-full bg-gray-50 border border-gray-300 rounded-xl px-4 py-3 outline-none focus:ring-2 focus:ring-emerald-500"
                >
                  <option value="" disabled>Select a user</option>
                  {users.filter(u => u.id !== selectedUser?.id).map(u => (
                    <option key={u.id} value={u.id}>{u.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Amount (BDT)</label>
                <input 
                  type="number" step="0.01" min="1" required
                  value={sendAmount} onChange={e => setSendAmount(e.target.value)}
                  className="w-full bg-gray-50 border border-gray-300 rounded-xl px-4 py-3 outline-none focus:ring-2 focus:ring-emerald-500"
                  placeholder="e.g. 500"
                />
              </div>
              <button disabled={loading} className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-3 rounded-xl transition-all shadow-md hover:shadow-lg disabled:opacity-50">
                Send Instantly
              </button>
            </form>
          </div>

          {/* Request Money */}
          <div className="bg-white p-8 rounded-3xl shadow-sm border border-gray-100">
            <h3 className="text-xl font-bold mb-6 flex items-center gap-2">
              <HandCoins size={20} className="text-blue-500" /> Request Money
            </h3>
            <form onSubmit={handleRequestMoney} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">From</label>
                <select
                  required
                  value={reqTargetId}
                  onChange={e => setReqTargetId(e.target.value)}
                  className="w-full bg-gray-50 border border-gray-300 rounded-xl px-4 py-3 outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="" disabled>Select a user</option>
                  {users.filter(u => u.id !== selectedUser?.id).map(u => (
                    <option key={u.id} value={u.id}>{u.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Amount (BDT)</label>
                <input
                  type="number" step="0.01" min="1" required
                  value={reqAmount} onChange={e => setReqAmount(e.target.value)}
                  className="w-full bg-gray-50 border border-gray-300 rounded-xl px-4 py-3 outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="e.g. 1000"
                />
              </div>
              <button disabled={loading} className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 rounded-xl transition-all shadow-md hover:shadow-lg disabled:opacity-50">
                Send Request
              </button>
            </form>
          </div>

          {/* Split Bill (even split across multiple recipients, single atomic POST) */}
          <div className="md:col-span-2 bg-white p-8 rounded-3xl shadow-sm border border-gray-100">
            <h3 className="text-xl font-bold mb-6 flex items-center gap-2">
              <Users size={20} className="text-violet-500" /> Split Bill
            </h3>
            <form onSubmit={handleSplitBill} className="space-y-5">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Split with</label>
                <div className="flex flex-wrap gap-2">
                  {users.filter(u => u.id !== selectedUser?.id).map(u => {
                    const active = splitRecipientIds.includes(u.id);
                    return (
                      <button
                        key={u.id}
                        type="button"
                        onClick={() => toggleSplitRecipient(u.id)}
                        className={`px-4 py-2 rounded-xl text-sm font-medium border transition-colors ${
                          active
                            ? 'bg-violet-600 text-white border-violet-600'
                            : 'bg-gray-50 text-gray-700 border-gray-300 hover:bg-gray-100'
                        }`}
                      >
                        {u.name}
                      </button>
                    );
                  })}
                </div>
                <p className="text-xs text-gray-400 mt-2">
                  {splitRecipientIds.length === 0
                    ? 'Tap one or more people to include in the split.'
                    : `${splitRecipientIds.length} selected`}
                </p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Total amount (BDT)</label>
                <input
                  type="number" step="0.01" min="1" required
                  value={splitTotalAmount}
                  onChange={e => setSplitTotalAmount(e.target.value)}
                  className="w-full bg-gray-50 border border-gray-300 rounded-xl px-4 py-3 outline-none focus:ring-2 focus:ring-violet-500"
                  placeholder="e.g. 1500"
                />
              </div>
              {splitPreview && (
                <div className="bg-violet-50 border border-violet-200 rounded-xl p-4 text-sm text-violet-900">
                  Each person owes <span className="font-bold">{formatCurrency(splitPreview.share)}</span>
                  {splitPreview.remainder > 0 && (
                    <> ({splitPreview.remainder} extra cent{splitPreview.remainder === 1 ? '' : 's'} go to the first recipient so the ledger stays balanced)</>
                  )}
                  .
                </div>
              )}
              <button
                disabled={loading || splitRecipientIds.length === 0}
                className="w-full bg-violet-600 hover:bg-violet-700 text-white font-bold py-3 rounded-xl transition-all shadow-md hover:shadow-lg disabled:opacity-50"
              >
                Split Payment
              </button>
            </form>
          </div>
        </div>

        {/* Recent Activity (transaction history) */}
        <div className="bg-white p-8 rounded-3xl shadow-sm border border-gray-100">
          <h3 className="text-xl font-bold mb-4 flex items-center gap-2">
            Recent Activity
            <span className="bg-gray-100 text-gray-600 text-xs px-2 py-1 rounded-full">{transactions.length}</span>
          </h3>
          {transactions.length === 0 ? (
            <p className="text-gray-400 text-sm italic text-center py-6">No transactions yet.</p>
          ) : (
            <div className="divide-y divide-gray-100">
              {transactions.map(tx => {
                const outgoing = tx.senderId === selectedUser?.id;
                const counterparty = outgoing ? tx.receiver : tx.sender;
                const sign = outgoing ? '-' : '+';
                const color = outgoing ? 'text-rose-600' : 'text-emerald-600';
                const arrow = outgoing ? '→' : '←';
                return (
                  <div key={tx.id} className="flex items-center justify-between py-3">
                    <div className="flex items-center gap-3">
                      <span className="text-gray-400 font-mono text-sm">{arrow}</span>
                      <div>
                        <p className="font-semibold text-gray-800">
                          {outgoing ? 'Sent to' : 'Received from'} {counterparty.name}
                        </p>
                        <p className="text-xs text-gray-400">
                          {new Date(tx.createdAt).toLocaleString('en-BD')} • {tx.status}
                        </p>
                      </div>
                    </div>
                    <p className={`font-bold ${color}`}>
                      {sign}{formatCurrency(tx.amount)}
                    </p>
                  </div>
                );
              })}
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
