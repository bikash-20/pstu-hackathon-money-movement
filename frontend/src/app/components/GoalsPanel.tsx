"use client";

/**
 * GoalsPanel.tsx
 *
 * Create savings goals + deposit into them.
 * Backend: GET/POST /api/goals/:userId  POST /api/goals/:id/deposit
 */

import React, { useCallback, useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Target, Plus, PiggyBank, CheckCircle2, Sparkles } from "lucide-react";
import { api, fmtBDT, uuid } from "../lib";
import type { Goal } from "../types";
import {
  Badge,
  Button,
  ConfirmModal,
  ConfirmState,
  EmptyState,
  GlassCard,
  Input,
  Label,
  ProgressBar,
  SectionHeader,
  Skeleton,
} from "./ui";

// ─── Component ────────────────────────────────────────────────────────────────
export function GoalsPanel({
  userId,
  onToast,
  onBalanceRefresh,
}: {
  userId: number;
  onToast: (type: "success" | "error", text: string) => void;
  onBalanceRefresh: () => void;
}) {
  const [goals, setGoals]           = useState<Goal[]>([]);
  const [loading, setLoading]       = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [confirm, setConfirm]       = useState<ConfirmState>(null);

  // Create form
  const [name, setName]             = useState("");
  const [target, setTarget]         = useState("");

  // Deposit form (keyed by goal id)
  const [depositAmts, setDepositAmts] = useState<Record<number, string>>({});
  const [busyGoal, setBusyGoal]       = useState<number | null>(null);

  // ── Fetch ──────────────────────────────────────────────────────────────────
  const load = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    try {
      const data = await api<Goal[]>(`/api/goals/${userId}`);
      setGoals(data);
    } catch {
      //
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => { load(); }, [load]);

  // ── Create ─────────────────────────────────────────────────────────────────
  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    const targetCents = Math.round(parseFloat(target) * 100);
    if (!name.trim() || !Number.isFinite(targetCents) || targetCents <= 0) return;

    try {
      await api("/api/goals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, name: name.trim(), targetAmount: targetCents }),
      });
      onToast("success", `Goal "${name.trim()}" created!`);
      setName("");
      setTarget("");
      setShowCreate(false);
      load();
    } catch (err) {
      onToast("error", (err as Error).message ?? "Failed to create goal");
    }
  }

  // ── Deposit ────────────────────────────────────────────────────────────────
  function requestDeposit(goal: Goal) {
    const raw    = depositAmts[goal.id] ?? "";
    const cents  = Math.round(parseFloat(raw) * 100);
    if (!Number.isFinite(cents) || cents <= 0) {
      onToast("error", "Enter a valid deposit amount");
      return;
    }
    setConfirm({
      title:       `Deposit to "${goal.name}"`,
      description: "Funds will be moved from your spendable balance into this goal.",
      amountLabel: fmtBDT(cents),
      onConfirm:   () => executeDeposit(goal.id, cents),
    });
  }

  async function executeDeposit(goalId: number, cents: number) {
    setBusyGoal(goalId);
    try {
      await api<{ success: boolean }>(`/api/goals/${goalId}/deposit`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": uuid() },
        body: JSON.stringify({ userId, amount: cents }),
      });
      onToast("success", "Deposit saved!");
      setDepositAmts((prev) => ({ ...prev, [goalId]: "" }));
      load();
      onBalanceRefresh();
    } catch (err) {
      onToast("error", (err as Error).message ?? "Deposit failed");
    } finally {
      setBusyGoal(null);
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  const active    = goals.filter((g) => !g.completedAt);
  const completed = goals.filter((g) =>  g.completedAt);

  return (
    <>
      <ConfirmModal state={confirm} onClose={() => setConfirm(null)} />

      <GlassCard>
        <SectionHeader
          icon={<Target className="w-4 h-4 text-[var(--primary)]" />}
          title="Savings Goals"
          badge={active.length > 0 ? <Badge tone="positive">{active.length} active</Badge> : undefined}
          action={
            <Button
              variant={showCreate ? "secondary" : "primary"}
              size="sm"
              onClick={() => setShowCreate((v) => !v)}
            >
              <Plus className="w-3.5 h-3.5" />
              {showCreate ? "Cancel" : "New Goal"}
            </Button>
          }
        />

        {/* ── Create form ───────────────────────────────────────────────── */}
        <AnimatePresence>
          {showCreate && (
            <motion.form
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
              onSubmit={handleCreate}
              className="overflow-hidden"
            >
              <div className="bg-[var(--muted)] rounded-2xl p-5 mb-6 border border-[var(--border)] space-y-4">
                <div>
                  <Label htmlFor="goal-name">Goal Name</Label>
                  <Input
                    id="goal-name"
                    type="text"
                    required
                    maxLength={60}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder='e.g. "New Laptop"'
                  />
                </div>
                <div>
                  <Label htmlFor="goal-target">Target Amount (BDT)</Label>
                  <Input
                    id="goal-target"
                    type="number"
                    required
                    min={1}
                    step="0.01"
                    value={target}
                    onChange={(e) => setTarget(e.target.value)}
                    placeholder="e.g. 50000"
                  />
                </div>
                <Button type="submit" variant="primary" size="lg">
                  <PiggyBank className="w-4 h-4" />
                  Create Goal
                </Button>
              </div>
            </motion.form>
          )}
        </AnimatePresence>

        {/* ── Goal list ─────────────────────────────────────────────────── */}
        {loading && goals.length === 0 ? (
          <div className="space-y-4">
            {[1, 2].map((i) => <Skeleton key={i} className="h-28 w-full" />)}
          </div>
        ) : goals.length === 0 ? (
          <EmptyState
            icon={<Target className="w-5 h-5 text-[var(--muted-foreground)]" />}
            title="No goals yet"
            subtitle="Create a goal to start saving towards a target"
          />
        ) : (
          <motion.ul className="space-y-4">
            {/* Active goals */}
            {active.map((g, idx) => {
              const pct = Math.min(100, Math.round((g.savedAmount / g.targetAmount) * 100));
              return (
                <motion.li
                  key={g.id}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.22, delay: Math.min(idx * 0.04, 0.3) }}
                  className="bg-[var(--muted)] rounded-2xl p-5 border border-[var(--border)] space-y-3"
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="font-semibold text-[var(--foreground)]">{g.name}</p>
                      <p className="text-xs text-[var(--muted-foreground)] tabular-nums mt-0.5">
                        {fmtBDT(g.savedAmount)} / {fmtBDT(g.targetAmount)}
                      </p>
                    </div>
                    <Badge tone={pct >= 100 ? "positive" : "neutral"}>{pct}%</Badge>
                  </div>

                  <ProgressBar
                    pct={pct}
                    color={pct >= 100 ? "var(--positive)" : "var(--primary)"}
                  />

                  {/* Deposit row */}
                  {!g.completedAt && (
                    <div className="flex gap-2 pt-1">
                      <Input
                        type="number"
                        min={1}
                        step="0.01"
                        value={depositAmts[g.id] ?? ""}
                        onChange={(e) =>
                          setDepositAmts((prev) => ({ ...prev, [g.id]: e.target.value }))
                        }
                        placeholder="Deposit (BDT)"
                        className="flex-1 py-2 text-sm"
                      />
                      <Button
                        variant="primary"
                        size="sm"
                        loading={busyGoal === g.id}
                        onClick={() => requestDeposit(g)}
                        className="flex-shrink-0"
                      >
                        <PiggyBank className="w-3.5 h-3.5" />
                        Save
                      </Button>
                    </div>
                  )}
                </motion.li>
              );
            })}

            {/* Completed goals */}
            {completed.length > 0 && (
              <li>
                <p className="text-xs uppercase tracking-widest text-[var(--muted-foreground)] mb-3 mt-2">
                  Completed
                </p>
                <ul className="space-y-3">
                  {completed.map((g, idx) => (
                    <motion.li
                      key={g.id}
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.22, delay: Math.min(idx * 0.04, 0.3) }}
                      className="flex items-center gap-3 bg-[var(--positive)]/5 border border-[var(--positive)]/20 rounded-2xl p-4"
                    >
                      <CheckCircle2 className="w-5 h-5 text-[var(--positive)] flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-[var(--foreground)] truncate">{g.name}</p>
                        <p className="text-xs text-[var(--muted-foreground)] tabular-nums">{fmtBDT(g.savedAmount)}</p>
                      </div>
                      <Sparkles className="w-4 h-4 text-[var(--primary)]" />
                    </motion.li>
                  ))}
                </ul>
              </li>
            )}
          </motion.ul>
        )}
      </GlassCard>
    </>
  );
}
