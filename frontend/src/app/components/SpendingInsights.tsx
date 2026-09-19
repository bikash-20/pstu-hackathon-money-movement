"use client";

/**
 * SpendingInsights.tsx
 *
 * Donut chart + ranked breakdown table.
 * Data: GET /api/insights/:userId?days=30
 */

import React, { useEffect, useState } from "react";
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from "recharts";
import { BarChart2 } from "lucide-react";
import { api, CATEGORY_COLORS, fmtBDT } from "../lib";
import type { InsightsData } from "../types";
import {
  Badge,
  Button,
  EmptyState,
  GlassCard,
  ProgressBar,
  SectionHeader,
  Skeleton,
} from "./ui";

// ─── Custom tooltip for the recharts donut ────────────────────────────────────
function ChartTooltip({ active, payload }: { active?: boolean; payload?: Array<{ name: string; value: number }> }) {
  if (!active || !payload?.length) return null;
  const { name, value } = payload[0];
  return (
    <div className="glass rounded-xl px-3 py-2 border border-[var(--border)] text-xs shadow-xl">
      <p className="font-semibold text-[var(--foreground)]">{name}</p>
      <p className="text-[var(--primary)] tabular-nums">{fmtBDT(value)}</p>
    </div>
  );
}

// ─── Day range selector ───────────────────────────────────────────────────────
const RANGES = [7, 30, 90] as const;

// ─── Component ────────────────────────────────────────────────────────────────
export function SpendingInsights({ userId }: { userId: number }) {
  const [days, setDays]       = useState<typeof RANGES[number]>(30);
  const [data, setData]       = useState<InsightsData | null>(null);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    if (!userId) return;
    setLoading(true);
    try {
      const d = await api<InsightsData>(`/api/insights/${userId}?days=${days}`);
      setData(d);
    } catch {
      // keep stale
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, [userId, days]);

  const chartData = (data?.breakdown ?? []).map((b) => ({
    name: b.category,
    value: b.total,
    color: CATEGORY_COLORS[b.category] ?? "#94A3B8",
  }));

  return (
    <GlassCard>
      <SectionHeader
        icon={<BarChart2 className="w-4 h-4 text-[var(--primary)]" />}
        title="Spending Insights"
        badge={
          data && (
            <Badge tone="neutral" className="ml-1">
              {fmtBDT(data.totalOut)} spent
            </Badge>
          )
        }
        action={
          <div className="flex items-center gap-1">
            {RANGES.map((r) => (
              <Button
                key={r}
                variant={days === r ? "primary" : "ghost"}
                size="sm"
                onClick={() => setDays(r)}
                className="text-xs px-2.5 py-1"
              >
                {r}d
              </Button>
            ))}
          </div>
        }
      />

      {loading && !data ? (
        <div className="space-y-3">
          <Skeleton className="h-44 w-full" />
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-4 w-1/2" />
        </div>
      ) : !data || data.breakdown.length === 0 ? (
        <EmptyState
          icon={<BarChart2 className="w-5 h-5 text-[var(--muted-foreground)]" />}
          title="No spending data yet"
          subtitle={`Send money to see your ${days}-day breakdown`}
        />
      ) : (
        <div className="grid md:grid-cols-2 gap-6 items-center">
          {/* ── Donut chart ─────────────────────────────────────────────── */}
          <div className="h-52">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={chartData}
                  dataKey="value"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  innerRadius="58%"
                  outerRadius="82%"
                  paddingAngle={2}
                  strokeWidth={0}
                >
                  {chartData.map((entry) => (
                    <Cell key={entry.name} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip content={<ChartTooltip />} />
              </PieChart>
            </ResponsiveContainer>
          </div>

          {/* ── Ranked list ──────────────────────────────────────────────── */}
          <ol className="space-y-3">
            {data.breakdown.slice(0, 6).map((b) => (
              <li key={b.category} className="space-y-1">
                <div className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2">
                    <span
                      className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                      style={{ background: CATEGORY_COLORS[b.category] ?? "#94A3B8" }}
                      aria-hidden="true"
                    />
                    <span className="font-medium text-[var(--foreground)]">{b.category}</span>
                    <Badge tone="neutral">{b.count}×</Badge>
                  </div>
                  <span className="tabular-nums text-[var(--muted-foreground)]">{b.pct}%</span>
                </div>
                <ProgressBar pct={b.pct} color={CATEGORY_COLORS[b.category] ?? "#94A3B8"} />
                <p className="text-right text-xs tabular-nums text-[var(--muted-foreground)]">
                  {fmtBDT(b.total)}
                </p>
              </li>
            ))}
          </ol>
        </div>
      )}
    </GlassCard>
  );
}
