import express from "express";
import cors from "cors";
import helmet from "helmet";
import dotenv from "dotenv";
import { PrismaClient } from "@prisma/client";
import { config } from "./config.js";
import { generalLimiter, moneyWriteLimiter, requireAdminSecret } from "./middleware.js";
import { transferRouter } from "./routes/transfer.js";
import { requestRouter } from "./routes/requests.js";
import { splitRouter } from "./routes/split.js";
import { scheduledRouter } from "./routes/scheduled.js";
import { qrRouter } from "./routes/qr.js";
import { contactsRouter } from "./routes/contacts.js";
import { goalsRouter } from "./routes/goals.js";
import { metaRouter } from "./routes/meta.js";
import { isExpired } from "./money.js";

dotenv.config();
const app = express();
const prisma = new PrismaClient();
app.set("trust proxy", 1);
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: (o, cb) => { if (!o || config.corsOrigins.includes("*") || config.corsOrigins.includes(o)) cb(null, true); else cb(new Error("CORS blocked")); } }));
app.use(express.json({ limit: "32kb" }));
app.use("/api/", generalLimiter);

app.get("/api/health", async (_req, res) => {
  try { await prisma.$queryRaw`SELECT 1`; res.json({ status: "ok", db: "reachable" }); }
  catch (e) { const m = (e as { message?: string }).message; res.status(503).json({ status: "degraded", error: m }); }
});

app.get("/api/users", async (_req, res) => {
  try {
    res.json(await prisma.user.findMany({ select: { id: true, name: true, balance: true, phone: true }, orderBy: { id: "asc" } }));
  } catch { res.status(500).json({ error: "Failed to fetch users" }); }
});

app.use("/api/transfer", moneyWriteLimiter, transferRouter(prisma));
app.use("/api/request", moneyWriteLimiter, requestRouter(prisma));
app.use("/api/split", moneyWriteLimiter, splitRouter(prisma));
app.use("/api/scheduled", moneyWriteLimiter, scheduledRouter(prisma));
app.use("/api/qr", moneyWriteLimiter, qrRouter(prisma));
app.use("/api/contacts", contactsRouter(prisma));
app.use("/api/goals", goalsRouter(prisma));
app.use("/api", metaRouter(prisma));

app.get("/api/requests/:userId", async (req, res) => {
  const userId = Number(req.params.userId);
  if (!Number.isInteger(userId) || userId <= 0) { res.status(400).json({ error: "Invalid user id" }); return; }
  try {
    await prisma.moneyRequest.updateMany({ where: { payerId: userId, status: "PENDING", expiresAt: { lt: new Date() } }, data: { status: "EXPIRED" } });
    res.json(await prisma.moneyRequest.findMany({ where: { payerId: userId, status: "PENDING" }, orderBy: { id: "desc" }, take: 50, include: { requester: { select: { name: true, phone: true } } } }));
  } catch { res.status(500).json({ error: "Failed to fetch requests" }); }
});
app.get("/api/requests-out/:userId", async (req, res) => {
  const userId = Number(req.params.userId);
  if (!Number.isInteger(userId) || userId <= 0) { res.status(400).json({ error: "Invalid user id" }); return; }
  const rows = await prisma.moneyRequest.findMany({ where: { requesterId: userId }, orderBy: { id: "desc" }, take: 50, include: { payer: { select: { name: true, phone: true } } } });
  res.json(rows.map((x) => ({ ...x, expired: x.status === "PENDING" && isExpired(new Date(x.expiresAt)) })));
});

app.get("/api/transactions/:userId", async (req, res) => {
  const userId = Number(req.params.userId);
  if (!Number.isInteger(userId) || userId <= 0) { res.status(400).json({ error: "Invalid user id" }); return; }
  const limit = Math.min(Number(req.query.limit ?? 50), 100);
  const cursor = Number(req.query.cursor ?? 0);
  const direction = String(req.query.direction ?? "all");
  const category = typeof req.query.category === "string" ? req.query.category : undefined;
  const q = typeof req.query.q === "string" ? req.query.q.trim().slice(0, 60) : "";
  try {
    const where: Record<string, unknown> = { status: "COMPLETED" };
    if (direction === "in") where.receiverId = userId;
    else if (direction === "out") where.senderId = userId;
    else where.OR = [{ senderId: userId }, { receiverId: userId }];
    if (category && category !== "ALL") where.category = category;
    if (q) where.memo = { contains: q, mode: "insensitive" };
    if (cursor > 0) (where as { id: object }).id = { lt: cursor };
    const txs = await prisma.transaction.findMany({ where: where as never, orderBy: { id: "desc" }, take: limit + 1, include: { sender: { select: { id: true, name: true, phone: true } }, receiver: { select: { id: true, name: true, phone: true } } } });
    const hasMore = txs.length > limit;
    const page = hasMore ? txs.slice(0, limit) : txs;
    res.json({ items: page, nextCursor: hasMore ? page[page.length - 1]?.id ?? null : null });
  } catch (e) { res.status(500).json({ error: (e as { message?: string }).message ?? "Failed" }); }
});

app.post("/api/seed", async (_req, res) => {
  try {
    if ((await prisma.user.count()) === 0) {
      await prisma.user.createMany({ data: [
        { name: "Alice", balance: 10000000, phone: "+880 1712-345678" },
        { name: "Bob", balance: 10000000, phone: "+880 1823-456789" },
        { name: "Charlie", balance: 10000000, phone: "+880 1934-567890" },
      ] });
      res.json({ success: true, message: "Users seeded" });
    } else res.json({ success: false, message: "Users already exist" });
  } catch (e) { res.status(500).json({ error: (e as { message?: string }).message }); }
});

app.post("/api/admin/reset", requireAdminSecret, async (_req, res) => {
  try {
    await prisma.notification.deleteMany({});
    await prisma.contact.deleteMany({});
    await prisma.goal.deleteMany({});
    await prisma.transaction.deleteMany({});
    await prisma.moneyRequest.deleteMany({});
    await prisma.user.deleteMany({});
    await prisma.user.createMany({ data: [
      { name: "Alice", balance: 10000000, phone: "+880 1712-345678" },
      { name: "Bob", balance: 10000000, phone: "+880 1823-456789" },
      { name: "Charlie", balance: 10000000, phone: "+880 1934-567890" },
    ] });
    await prisma.auditLog.create({ data: { action: "ADMIN_RESET", detail: "Demo state reset" } });
    const users = await prisma.user.findMany({ select: { id: true, name: true, balance: true, phone: true }, orderBy: { id: "asc" } });
    res.json({ success: true, message: "Demo state reset", users });
  } catch (e) { res.status(500).json({ error: (e as { message?: string }).message }); }
});

app.listen(config.port, () => { console.log(`Server on port ${config.port}`); });
