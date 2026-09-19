import { z } from "zod";
import { CATEGORIES, FUNDING_PROVIDERS, FX_CURRENCIES, RECURRING_CADENCES } from "./config.js";

const id = z.number().int().positive();
const cents = z.number().int().positive().max(100_000_000);
const memo = z.string().trim().max(140).optional();
const category = z.enum(CATEGORIES).optional().default("TRANSFER");

export const transferSchema = z.object({
  senderId: id,
  receiverId: id,
  amount: cents,
  memo,
  category,
}).refine((v) => v.senderId !== v.receiverId, { message: "Cannot send money to yourself" });

export const scheduleSchema = z.object({
  senderId: id,
  receiverId: id,
  amount: cents,
  memo,
  category,
  // ISO datetime string in the future (client schedules; worker settles).
  executeAt: z.string().datetime(),
}).refine((v) => v.senderId !== v.receiverId, { message: "Cannot send money to yourself" });

export const requestSchema = z.object({
  requesterId: id,
  payerId: id,
  amount: cents,
  note: z.string().trim().max(140).optional(),
}).refine((v) => v.requesterId !== v.payerId, { message: "Cannot request money from yourself" });

export const paySchema = z.object({ payerId: id });

export const splitSchema = z.object({
  initiatorId: id,
  recipientIds: z.array(id).min(1).max(20),
  totalAmount: cents,
  memo,
  category,
}).refine((v) => !v.recipientIds.includes(v.initiatorId), {
  message: "Cannot split a bill to yourself",
});

export const contactSchema = z.object({
  ownerId: id,
  contactId: id,
  nickname: z.string().trim().max(40).optional(),
}).refine((v) => v.ownerId !== v.contactId, { message: "Cannot add yourself as a contact" });

export const goalSchema = z.object({
  userId: id,
  name: z.string().trim().min(1).max(60),
  targetAmount: cents,
});

export const goalDepositSchema = z.object({
  userId: id,
  amount: cents,
});

export const qrPaySchema = z.object({
  senderId: id,
  amount: cents,
  memo,
  category,
});

// ─── External-payments v3 schemas ─────────────────────────────────────────────

export const fundingAddSchema = z.object({
  userId: id,
  amount: cents,
  source: z.enum(FUNDING_PROVIDERS),
  memo,
});

export const fundingWithdrawSchema = z.object({
  userId: id,
  amount: cents,
  destination: z.enum(FUNDING_PROVIDERS),
  // Account reference the user gave us (MFS wallet number, bank account last 4).
  // Optional: not all rails require it for a demo top-up.
  accountRef: z.string().trim().max(40).optional(),
  memo,
});

export const merchantPaySchema = z.object({
  userId: id,
  // Short code like "DARAZ"; we look it up in the Merchant table to get the
  // human label and validate it exists before money moves.
  merchantCode: z.string().trim().min(2).max(32),
  amount: cents,
  // External order reference — written into the memo so a refund/audit can
  // be traced back to the merchant's order id.
  orderRef: z.string().trim().max(40).optional(),
  memo,
});

export const refundSchema = z.object({
  originalId: id,
  // Original sender is the only authorized requester; validated again at
  // query time inside the route (defence-in-depth).
  requesterId: id,
  reason: z.string().trim().max(140).optional(),
});

export const recurringSchema = z.object({
  userId: id,
  recipientId: id,
  amount: cents,
  cadence: z.enum(RECURRING_CADENCES),
  // First execution timestamp. ISO datetime string.
  startAt: z.string().datetime(),
  memo,
  category,
}).refine((v) => v.userId !== v.recipientId, { message: "Cannot recurring-pay yourself" });

export const fxTransferSchema = z.object({
  senderId: id,
  receiverId: id,
  // Foreign-currency amount in its own major unit (e.g. 10 = $10 USD).
  amountForeign: z.number().positive().max(10_000_000),
  currency: z.enum(FX_CURRENCIES),
  category,
  memo,
});

export function parse<T>(schema: z.ZodType<T>, body: unknown): { ok: true; value: T } | { ok: false; error: string } {
  const r = schema.safeParse(body);
  if (r.success) return { ok: true, value: r.data };
  const first = r.error.issues[0];
  return { ok: false, error: first ? `${first.path.join(".") || "body"}: ${first.message}` : "Invalid request body" };
}
