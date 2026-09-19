import { z } from "zod";
import { CATEGORIES } from "./config.js";

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

export function parse<T>(schema: z.ZodType<T>, body: unknown): { ok: true; value: T } | { ok: false; error: string } {
  const r = schema.safeParse(body);
  if (r.success) return { ok: true, value: r.data };
  const first = r.error.issues[0];
  return { ok: false, error: first ? `${first.path.join(".") || "body"}: ${first.message}` : "Invalid request body" };
}
