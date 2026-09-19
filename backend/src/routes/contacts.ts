import { Router } from "express";
import type { PrismaClient } from "@prisma/client";
import { parse, contactSchema } from "../validate.js";

/** Saved payees — one row per (owner, contact) pair. */
export function contactsRouter(prisma: PrismaClient): Router {
  const r = Router();

  r.get("/:ownerId", async (req, res) => {
    const ownerId = Number(req.params.ownerId);
    if (!Number.isInteger(ownerId) || ownerId <= 0) {
      res.status(400).json({ error: "Invalid owner id" });
      return;
    }
    const rows = await prisma.contact.findMany({ where: { ownerId }, orderBy: { id: "desc" } });
    const ids = rows.map((c) => c.contactId);
    const users = ids.length
      ? await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, phone: true } })
      : [];
    const byId = new Map(users.map((u) => [u.id, u]));
    res.json(rows.map((c) => ({ ...c, contact: byId.get(c.contactId) ?? null })));
  });

  r.post("/", async (req, res) => {
    const parsed = parse(contactSchema, req.body);
    if (!parsed.ok) {
      res.status(400).json({ error: parsed.error });
      return;
    }
    try {
      const contact = await prisma.contact.create({ data: parsed.value });
      res.json({ success: true, contact });
    } catch (error: unknown) {
      const err = error as { code?: string };
      if (err?.code === "P2002") {
        res.status(400).json({ error: "Contact already saved" });
        return;
      }
      res.status(400).json({ error: "Failed to save contact" });
    }
  });

  r.delete("/:id", async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ error: "Invalid contact id" });
      return;
    }
    await prisma.contact.deleteMany({ where: { id } });
    res.json({ success: true });
  });

  return r;
}
