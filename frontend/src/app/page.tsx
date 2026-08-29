"use client";

import { useEffect, useState } from "react";
import { ArrowRightLeft, HandCoins, CheckCircle, XCircle } from "lucide-react";

type User = { id: number; name: string; balance: number };
type MoneyRequest = { id: number; amount: number; requester: { name: string } };

let API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000/api";
if (API_URL.endsWith('/')) API_URL = API_URL.slice(0, -1);
if (!API_URL.endsWith('/api')) API_URL += '/api';

function formatCurrency(cents: number) {
  return new Intl.NumberFormat("en-BD", {
    style: "currency",
    currency: "BDT",
  }).format(cents / 100);
}

export default function Home() {
  const [users, setUsers] = useState<User[]>([]);
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [requests, setRequests] = useState<MoneyRequest[]>([]);

  // Forms State
  const [sendTargetId, setSendTargetId] = useState("");
  const [sendAmount, setSendAmount] = useState("");
  const [reqTargetId, setReqTargetId] = useState("");
  const [reqAmount, setReqAmount] = useState("");

  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetchUsers();
  }, []);

  useEffect(() => {
    if (selectedUser) {
      fetchRequests(selectedUser.id);
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

  const refreshData = async () => {
    const latestUsers = await fetchUsers();
    if (selectedUser) {
      const updated = latestUsers.find(u => u.id === selectedUser.id);
      if (updated) setSelectedUser(updated);
      fetchRequests(selectedUser.id);
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
        </div>

      </div>
    </div>
  );
}
