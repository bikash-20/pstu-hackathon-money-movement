import type { Prisma, PrismaClient } from "@prisma/client";
import { config } from "./config.js";

// Prisma interactive-transaction client type (subset we use).
type Tx = Omit<PrismaClient, "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends">;

export interface LockedUser {
  id: number;
  balance: number;
  dailySpent: number;
  dailySpentAt: Date;
}

/** SELECT ... FOR UPDATE on a user row inside an interactive transaction. */
export async function lockUser(tx: Tx, id: number): Promise<LockedUser | null> {
  const rows = await tx.$queryRaw<LockedUser[]>`SELECT id, balance, "dailySpent", "dailySpentAt" FROM "User" WHERE id = ${id} FOR UPDATE;`;
  return rows[0] ?? null;
}

/** Reset the UTC-day spend window when the stored stamp is from an older day. */
export function currentDaySpent(user: LockedUser): number {
  const stamp = new Date(user.dailySpentAt);
  const now = new Date();
  const sameDay =
    stamp.getUTCFullYear() === now.getUTCFullYear() &&
    stamp.getUTCMonth() === now.getUTCMonth() &&
    stamp.getUTCDate() === now.getUTCDate();
  return sameDay ? user.dailySpent : 0;
}

/** Enforce the daily spend ceiling; throws a user-facing Error when breached. */
export function assertDailyLimit(user: LockedUser, amount: number): number {
  const spent = currentDaySpent(user);
  if (spent + amount > config.dailyLimitCents) {
    throw new Error(
      `Daily limit exceeded (৳${(config.dailyLimitCents / 100).toLocaleString("en-US")}/day). Try a smaller amount tomorrow.`
    );
  }
  return spent;
}

/** Bump dailySpent after a successful debit (resets the stamp on day rollover). */
export async function bumpDailySpent(tx: Tx, userId: number, prevSpent: number, amount: number): Promise<void> {
  const stamp = new Date();
  await tx.$executeRaw`UPDATE "User" SET "dailySpent" = ${prevSpent + amount}, "dailySpentAt" = ${stamp} WHERE id = ${userId};`;
}

export async function notify(
  tx: Tx,
  userId: number,
  kind: string,
  title: string,
  body?: string | null
): Promise<void> {
  await tx.notification.create({ data: { userId, kind, title, body } });
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
