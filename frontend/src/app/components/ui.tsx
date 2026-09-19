"use client";

/**
 * ui.tsx — Reusable design-system atoms for PSTU Wallet.
 *
 * Every primitive here honours the CSS tokens declared in globals.css so that
 * a single variable change propagates to the entire UI without hunting for
 * hard-coded hex values.
 */

import React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { CheckCircle, XCircle, Loader2, AlertTriangle } from "lucide-react";

// ─── Animation presets ────────────────────────────────────────────────────────
export const fadeUp = {
  hidden: { opacity: 0, y: 14 },
  show:   { opacity: 1, y: 0, transition: { duration: 0.4, ease: [0.22, 1, 0.36, 1] as const } },
};

export const stagger = {
  hidden: {},
  show:   { transition: { staggerChildren: 0.055, delayChildren: 0.05 } },
};

export const scaleIn = {
  hidden: { opacity: 0, scale: 0.95 },
  show:   { opacity: 1, scale: 1, transition: { duration: 0.35, ease: [0.22, 1, 0.36, 1] as const } },
};

export const toastVariants = {
  hidden: { opacity: 0, y: -18, scale: 0.97 },
  show:   { opacity: 1, y: 0,  scale: 1,   transition: { duration: 0.35, ease: [0.22, 1, 0.36, 1] as const } },
  exit:   { opacity: 0, y: -10, scale: 0.97, transition: { duration: 0.2 } },
};

// ─── Skeleton ─────────────────────────────────────────────────────────────────
export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`shimmer rounded-xl ${className}`} aria-hidden="true" />;
}

// ─── GlassCard ────────────────────────────────────────────────────────────────
export function GlassCard({
  children,
  className = "",
  as: Tag = "div",
}: {
  children: React.ReactNode;
  className?: string;
  // React 19: `keyof JSX.IntrinsicElements` lives on the React namespace.
  as?: keyof React.JSX.IntrinsicElements;
}) {
  return (
    <Tag className={`glass glass-hover rounded-3xl p-6 md:p-8 ${className}`}>
      {children}
    </Tag>
  );
}

// ─── SectionHeader ────────────────────────────────────────────────────────────
export function SectionHeader({
  icon,
  title,
  badge,
  action,
}: {
  icon: React.ReactNode;
  title: string;
  badge?: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between mb-6">
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-xl bg-[var(--primary)]/10 border border-[var(--primary)]/20 flex items-center justify-center flex-shrink-0">
          {icon}
        </div>
        <h3 className="text-lg font-semibold text-[var(--foreground)]">{title}</h3>
        {badge}
      </div>
      {action}
    </div>
  );
}

// ─── Badge ────────────────────────────────────────────────────────────────────
type BadgeTone = "neutral" | "positive" | "warn" | "info";

const badgeTones: Record<BadgeTone, string> = {
  neutral:  "bg-[var(--muted)] text-[var(--muted-foreground)] border-[var(--border)]",
  positive: "bg-[var(--positive)]/10 text-[var(--positive)] border-[var(--positive)]/30",
  warn:     "bg-[var(--negative)]/10 text-[var(--negative)] border-[var(--negative)]/30",
  info:     "bg-indigo-400/10 text-indigo-300 border-indigo-400/30",
};

export function Badge({
  children,
  tone = "neutral",
  className = "",
}: {
  children: React.ReactNode;
  tone?: BadgeTone;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 text-xs px-2.5 py-0.5 rounded-full border font-medium ${badgeTones[tone]} ${className}`}
    >
      {children}
    </span>
  );
}

// ─── Button ───────────────────────────────────────────────────────────────────
type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

const btnBase =
  "inline-flex items-center justify-center gap-2 font-semibold rounded-xl transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] disabled:opacity-50 disabled:cursor-not-allowed";

const btnVariants: Record<ButtonVariant, string> = {
  primary:
    "bg-[var(--primary)] text-[var(--primary-foreground)] hover:brightness-110 shadow-lg shadow-[var(--primary)]/15 hover:shadow-[var(--primary)]/25",
  secondary:
    "bg-[var(--muted)] text-[var(--foreground)] border border-[var(--border)] hover:border-[var(--primary)]/40",
  ghost:
    "bg-transparent text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)]",
  danger:
    "bg-[var(--negative)]/10 text-[var(--negative)] border border-[var(--negative)]/30 hover:bg-[var(--negative)]/20",
};

export function Button({
  children,
  variant = "primary",
  size = "md",
  className = "",
  loading = false,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: "sm" | "md" | "lg";
  loading?: boolean;
}) {
  const sizes = { sm: "text-xs px-3 py-1.5", md: "text-sm px-4 py-2.5", lg: "text-base px-6 py-3 w-full" };
  return (
    <button
      className={`${btnBase} ${btnVariants[variant]} ${sizes[size]} ${className}`}
      disabled={loading || props.disabled}
      {...props}
    >
      {loading && <Loader2 className="w-4 h-4 animate-spin" />}
      {children}
    </button>
  );
}

// ─── Input ────────────────────────────────────────────────────────────────────
export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`w-full bg-[var(--muted)] border border-[var(--border)] rounded-xl px-4 py-3 text-sm text-[var(--foreground)] placeholder:text-[var(--muted-foreground)] outline-none focus:ring-2 focus:ring-[var(--ring)]/40 focus:border-[var(--primary)]/60 transition-colors tabular-nums ${props.className ?? ""}`}
    />
  );
}

// ─── Select ───────────────────────────────────────────────────────────────────
export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <div className="relative">
      <select
        {...props}
        className={`appearance-none w-full bg-[var(--muted)] border border-[var(--border)] rounded-xl px-4 py-3 text-sm text-[var(--foreground)] outline-none focus:ring-2 focus:ring-[var(--ring)]/40 focus:border-[var(--primary)]/60 transition-colors cursor-pointer pr-9 ${props.className ?? ""}`}
      />
      <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[var(--muted-foreground)] text-xs">
        ▾
      </span>
    </div>
  );
}

// ─── Label ────────────────────────────────────────────────────────────────────
export function Label({ children, htmlFor }: { children: React.ReactNode; htmlFor?: string }) {
  return (
    <label
      htmlFor={htmlFor}
      className="block text-xs uppercase tracking-widest text-[var(--muted-foreground)] mb-2 font-medium"
    >
      {children}
    </label>
  );
}

// ─── Toast ────────────────────────────────────────────────────────────────────
export type ToastMessage = { id: string; type: "success" | "error" | "warn"; text: string };

export function ToastBanner({ msg }: { msg: ToastMessage }) {
  const styles = {
    success: "bg-[var(--positive)]/10 border-[var(--positive)]/35 text-[var(--positive)]",
    error:   "bg-[var(--negative)]/10 border-[var(--negative)]/35 text-[var(--negative)]",
    warn:    "bg-amber-500/10 border-amber-400/35 text-amber-300",
  };
  const Icon = {
    success: CheckCircle,
    error:   XCircle,
    warn:    AlertTriangle,
  }[msg.type];

  return (
    <motion.div
      key={msg.id}
      variants={toastVariants}
      initial="hidden"
      animate="show"
      exit="exit"
      role="status"
      aria-live="polite"
      className={`rounded-2xl px-5 py-4 flex items-center gap-3 font-medium shadow-xl border ${styles[msg.type]}`}
    >
      <Icon className="w-5 h-5 flex-shrink-0" />
      <span className="text-sm">{msg.text}</span>
    </motion.div>
  );
}

// ─── ConfirmModal ─────────────────────────────────────────────────────────────
export type ConfirmState = {
  title: string;
  description: string;
  amountLabel?: string; // pre-formatted BDT string
  onConfirm: () => Promise<void>;
} | null;

export function ConfirmModal({
  state,
  onClose,
}: {
  state: ConfirmState;
  onClose: () => void;
}) {
  const [busy, setBusy] = React.useState(false);

  // Reset busy state when modal opens/closes
  React.useEffect(() => { setBusy(false); }, [state]);

  async function handleConfirm() {
    if (!state) return;
    setBusy(true);
    try {
      await state.onConfirm();
    } finally {
      setBusy(false);
      onClose();
    }
  }

  return (
    <AnimatePresence>
      {state && (
        <motion.div
          key="overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: "rgba(2, 6, 23, 0.82)", backdropFilter: "blur(6px)" }}
          onClick={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}
        >
          <motion.div
            variants={scaleIn}
            initial="hidden"
            animate="show"
            exit="hidden"
            className="glass rounded-3xl p-8 w-full max-w-sm shadow-2xl border border-[var(--primary)]/25"
            role="dialog"
            aria-modal="true"
            aria-labelledby="confirm-title"
          >
            <div className="flex items-start gap-4 mb-6">
              <div className="w-11 h-11 rounded-2xl bg-[var(--primary)]/10 border border-[var(--primary)]/25 flex items-center justify-center flex-shrink-0">
                <AlertTriangle className="w-5 h-5 text-[var(--primary)]" />
              </div>
              <div>
                <h2 id="confirm-title" className="text-lg font-bold text-[var(--foreground)]">
                  {state.title}
                </h2>
                <p className="text-sm text-[var(--muted-foreground)] mt-1">{state.description}</p>
              </div>
            </div>

            {state.amountLabel && (
              <div className="bg-[var(--muted)] rounded-2xl p-4 text-center mb-6 border border-[var(--border)]">
                <p className="text-xs text-[var(--muted-foreground)] uppercase tracking-widest mb-1">Amount</p>
                <p className="text-3xl font-bold tabular-nums text-[var(--primary)]">{state.amountLabel}</p>
              </div>
            )}

            <div className="flex gap-3">
              <Button variant="secondary" size="md" className="flex-1" onClick={onClose} disabled={busy}>
                Cancel
              </Button>
              <Button variant="primary" size="md" className="flex-1" onClick={handleConfirm} loading={busy}>
                Confirm
              </Button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// ─── EmptyState ───────────────────────────────────────────────────────────────
export function EmptyState({ icon, title, subtitle }: { icon: React.ReactNode; title: string; subtitle?: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-14 text-center gap-3">
      <div className="w-12 h-12 rounded-2xl bg-[var(--muted)] border border-[var(--border)] flex items-center justify-center">
        {icon}
      </div>
      <div>
        <p className="text-[var(--muted-foreground)] text-sm font-medium">{title}</p>
        {subtitle && <p className="text-[var(--muted-foreground)]/60 text-xs mt-0.5">{subtitle}</p>}
      </div>
    </div>
  );
}

// ─── ProgressBar ─────────────────────────────────────────────────────────────
export function ProgressBar({ pct, color = "var(--primary)" }: { pct: number; color?: string }) {
  const clamped = Math.min(100, Math.max(0, pct));
  return (
    <div className="h-2 w-full bg-[var(--muted)] rounded-full overflow-hidden" role="progressbar" aria-valuenow={clamped} aria-valuemin={0} aria-valuemax={100}>
      <div
        className="h-full rounded-full transition-all duration-700"
        style={{ width: `${clamped}%`, background: color }}
      />
    </div>
  );
}
