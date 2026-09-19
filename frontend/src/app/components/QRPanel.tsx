"use client";

/**
 * QRPanel.tsx
 *
 * Two sub-flows in a single card:
 *  1. Issue a QR code (server generates a `pstuqr.<id>.<amount>.<nonce>` token)
 *  2. Redeem a code (paste-and-pay)
 *
 * No image vendor required — the payload itself is the "QR code" for the demo.
 */

import React, { useState } from "react";
import { QrCode, ScanLine, Copy, CheckCheck } from "lucide-react";
import { api, fmtBDT, uuid } from "../lib";
import type { User } from "../types";
import {
  Badge,
  Button,
  ConfirmModal,
  ConfirmState,
  GlassCard,
  Input,
  Label,
  SectionHeader,
} from "./ui";

// ─── Issue sub-panel ──────────────────────────────────────────────────────────
function IssueForm({ userId, onToast }: { userId: number; onToast: (type: "success" | "error", text: string) => void }) {
  const [amount, setAmount]   = useState("");
  const [code, setCode]       = useState<string | null>(null);
  const [copied, setCopied]   = useState(false);
  const [busy, setBusy]       = useState(false);

  async function handleIssue(e: React.FormEvent) {
    e.preventDefault();
    const cents = Math.round(parseFloat(amount) * 100);
    if (!Number.isFinite(cents) || cents <= 0) return;
    setBusy(true);
    try {
      const res = await api<{ success: boolean; code: string; receiver: string; amount: number }>(
        "/api/qr/issue",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ receiverId: userId, amount: cents }),
        }
      );
      setCode(res.code);
      onToast("success", "QR code generated — share the code below");
    } catch (err) {
      onToast("error", (err as Error).message ?? "Failed to generate code");
    } finally {
      setBusy(false);
    }
  }

  async function copyCode() {
    if (!code) return;
    await navigator.clipboard.writeText(code).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="space-y-4">
      <form onSubmit={handleIssue} className="flex gap-2">
        <div className="flex-1">
          <Label htmlFor="qr-amount">Amount to receive (BDT)</Label>
          <Input
            id="qr-amount"
            type="number"
            min={1}
            step="0.01"
            required
            value={amount}
            onChange={(e) => { setAmount(e.target.value); setCode(null); }}
            placeholder="e.g. 500"
          />
        </div>
        <div className="flex items-end">
          <Button type="submit" variant="primary" size="md" loading={busy}>
            <QrCode className="w-4 h-4" />
            Generate
          </Button>
        </div>
      </form>

      {code && (
        <div className="bg-[var(--muted)] rounded-2xl p-4 border border-[var(--primary)]/20 space-y-3">
          <p className="text-xs uppercase tracking-widest text-[var(--muted-foreground)]">Your payment code</p>
          <div className="flex items-center gap-2">
            <code className="flex-1 text-xs font-mono text-[var(--primary)] break-all bg-[var(--card)] rounded-xl px-3 py-2 border border-[var(--border)]">
              {code}
            </code>
            <button
              onClick={copyCode}
              aria-label="Copy code"
              className="w-9 h-9 rounded-xl bg-[var(--muted)] border border-[var(--border)] flex items-center justify-center hover:border-[var(--primary)]/40 transition-colors flex-shrink-0"
            >
              {copied
                ? <CheckCheck className="w-4 h-4 text-[var(--positive)]" />
                : <Copy       className="w-4 h-4 text-[var(--muted-foreground)]" />}
            </button>
          </div>
          <p className="text-xs text-[var(--muted-foreground)]">
            Share this code with the payer. It encodes your user ID, amount, and a one-time nonce.
          </p>
        </div>
      )}
    </div>
  );
}

// ─── Redeem sub-panel ─────────────────────────────────────────────────────────
function RedeemForm({
  userId,
  onToast,
  onBalanceRefresh,
}: {
  userId: number;
  onToast: (type: "success" | "error", text: string) => void;
  onBalanceRefresh: () => void;
}) {
  const [code, setCode]       = useState("");
  const [memo, setMemo]       = useState("");
  const [confirm, setConfirm] = useState<ConfirmState>(null);
  const [busy, setBusy]       = useState(false);

  // Parse amount from the code string for preview
  const previewCents = (() => {
    const m = /^pstuqr\.(\d+)\.(\d+)\.[a-z0-9]+$/.exec(code.trim());
    return m ? parseInt(m[2]) : null;
  })();

  function requestRedeem(e: React.FormEvent) {
    e.preventDefault();
    if (!previewCents) { onToast("error", "Invalid QR code format"); return; }
    setConfirm({
      title:       "Pay via QR Code",
      description: "Funds will be transferred immediately to the code's owner.",
      amountLabel: fmtBDT(previewCents),
      onConfirm:   executeRedeem,
    });
  }

  async function executeRedeem() {
    setBusy(true);
    try {
      await api("/api/qr/redeem", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": uuid() },
        body: JSON.stringify({ senderId: userId, code: code.trim(), memo: memo.trim() || undefined }),
      });
      onToast("success", "QR payment sent!");
      setCode(""); setMemo("");
      onBalanceRefresh();
    } catch (err) {
      onToast("error", (err as Error).message ?? "Redeem failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <ConfirmModal state={confirm} onClose={() => setConfirm(null)} />
      <form onSubmit={requestRedeem} className="space-y-4">
        <div>
          <Label htmlFor="qr-code-input">Paste QR Code</Label>
          <Input
            id="qr-code-input"
            type="text"
            required
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="pstuqr.2.50000.abc12345"
            className="font-mono text-xs"
          />
          {previewCents && (
            <p className="mt-1.5 text-xs text-[var(--positive)]">
              ✓ Valid code — amount: <span className="tabular-nums font-semibold">{fmtBDT(previewCents)}</span>
            </p>
          )}
        </div>
        <div>
          <Label htmlFor="qr-redeem-memo">Memo (optional)</Label>
          <Input
            id="qr-redeem-memo"
            type="text"
            maxLength={140}
            value={memo}
            onChange={(e) => setMemo(e.target.value)}
            placeholder="What's this for?"
          />
        </div>
        <Button type="submit" variant="primary" size="lg" loading={busy} disabled={!previewCents}>
          <ScanLine className="w-4 h-4" />
          Pay via QR Code
        </Button>
      </form>
    </>
  );
}

// ─── Main panel ───────────────────────────────────────────────────────────────
type QrTab = "issue" | "redeem";

export function QRPanel({
  userId,
  onToast,
  onBalanceRefresh,
}: {
  userId: number;
  onToast: (type: "success" | "error", text: string) => void;
  onBalanceRefresh: () => void;
}) {
  const [tab, setTab] = useState<QrTab>("issue");

  return (
    <GlassCard>
      <SectionHeader
        icon={<QrCode className="w-4 h-4 text-[var(--primary)]" />}
        title="QR Pay"
      />

      {/* Tab bar */}
      <div className="flex gap-2 p-1 bg-[var(--muted)] rounded-2xl mb-6 border border-[var(--border)]">
        {(["issue", "redeem"] as QrTab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex-1 py-2 rounded-xl text-sm font-semibold transition-all ${
              tab === t
                ? "bg-[var(--primary)] text-[var(--primary-foreground)] shadow-lg"
                : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
            }`}
          >
            {t === "issue" ? "Generate Code" : "Scan & Pay"}
          </button>
        ))}
      </div>

      {tab === "issue"
        ? <IssueForm  userId={userId} onToast={onToast} />
        : <RedeemForm userId={userId} onToast={onToast} onBalanceRefresh={onBalanceRefresh} />
      }
    </GlassCard>
  );
}
