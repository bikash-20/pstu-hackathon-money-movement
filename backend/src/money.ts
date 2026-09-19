import type { Prisma, PrismaClient } from "@prisma/client";
import { config } from "./config.js";

// Prisma interactive-transaction client type (subset we use).
type Tx = Omit<PrismaClient, "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends">;

export interface LockedUser {
  id: number;
  balance: number;
  dailySpent: number;
  dailyWindow: string;
}

/** SELECT ... FOR UPDATE on a user row inside an interactive transaction. */
export async function lockUser(tx: Tx, id: number): Promise<LockedUser | null> {
  const rows = await tx.$queryRaw<LockedUser[]>`
    SELECT id, balance, "dailySpent", "dailyWindow" FROM "User" WHERE id = ${id} FOR UPDATE;`;
  return rows[0] ?? null;
}

/**
 * Settlement-day key for the configured business timezone, formatted
 * "YYYY-MM-DD". `en-CA` is the one locale whose short date is ISO-ordered, so
 * this needs no date library and no manual offset arithmetic.
 */
export function dayKey(at: Date = new Date(), timeZone: string = config.timezone): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at);
}

/**
 * Spend already counted against today's ceiling. A stale window key means the
 * user rolled into a new settlement day, so yesterday's tally no longer counts.
 */
export function currentDaySpent(user: Pick<LockedUser, "dailySpent" | "dailyWindow">): number {
  return user.dailyWindow === dayKey() ? user.dailySpent : 0;
}

/** Enforce the daily spend ceiling; throws a user-facing Error when breached. */
export function assertDailyLimit(user: LockedUser, amount: number): number {
  const spent = currentDaySpent(user);
  if (spent + amount > config.dailyLimitCents) {
    const remaining = Math.max(0, config.dailyLimitCents - spent);
    throw new Error(
      `Daily limit exceeded (${fmtBDT(config.dailyLimitCents)}/day). ${fmtBDT(remaining)} left today — try a smaller amount or retry tomorrow.`
    );
  }
  return spent;
}

/**
 * Persist the new running total. Written through Prisma's typed client (never
 * raw SQL) so the day key and counter share one encoding — raw `$executeRaw`
 * binds a JS Date as *local* wall-clock while Prisma writes UTC, and that
 * mismatch silently resets the window every transfer.
 */
export async function bumpDailySpent(tx: Tx, userId: number, prevSpent: number, amount: number): Promise<void> {
  await tx.user.update({
    where: { id: userId },
    data: { dailySpent: prevSpent + amount, dailyWindow: dayKey() },
  });
}

export async function notify(
  tx: Tx,
  userId: number,
  kind: string,
  title: string,
  body?: string | null
): Promise<void> {
  await tx.notification.create({ data: { userId, kind, title, body: body ?? null } });
}

export function fmtBDT(cents: number): string {
  return `৳${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function isExpired(expiresAt: Date): boolean {
  return expiresAt.getTime() <= Date.now();
}

export function expiryDate(days = config.requestExpiryDays): Date {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}

export interface PrismaLike extends Tx {
  $transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T>;
}

export type Db = PrismaClient | Prisma.TransactionClient;
