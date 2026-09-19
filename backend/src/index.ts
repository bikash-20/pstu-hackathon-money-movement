import express from "express";
import cors from "cors";
import helmet from "helmet";
import dotenv from "dotenv";
import { PrismaClient } from "@prisma/client";
import { config } from "./config.js";
import { generalLimiter, moneyWriteLimiter, requireAdminSecret, fail } from "./middleware.js";
import { transferRouter } from "./routes/transfer.js";
import { requestRouter } from "./routes/requests.js";
import { splitRouter } from "./routes/split.js";
import { scheduledRouter } from "./routes/scheduled.js";
import { qrRouter } from "./routes/qr.js";
import { contactsRouter } from "./routes/contacts.js";
import { goalsRouter } from "./routes/goals.js";
import { fundingRouter } from "./routes/funding.js";
import { merchantRouter } from "./routes/merchant.js";
import { refundsRouter } from "./routes/refunds.js";
import { recurringRouter } from "./routes/recurring.js";
import { fxRouter } from "./routes/fx.js";
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

/**
 * Seed the synthetic "External" user (id 0). This row is the off-wallet
 * counterparty for every funding, merchant, refund and FX flow so the
 * Transaction ledger has a real foreign key to point at.
 */
async function ensureExternalUser(): Promise<void> {
  const existing = await prisma.user.findUnique({ where: { id: 0 } });
  if (!existing) {
    await prisma.user.create({
      data: {
        id: 0,
        name: "External (MFS / Bank / Merchant)",
        // Unbounded balance — External is the off-wallet sink/source.
        balance: 0,
        phone: null,
        dailySpent: 0,
        dailyWindow: "",
      },
    });
  }
}

/** Seed the merchant directory used by /api/merchant/pay. */
async function ensureMerchants(): Promise<void> {
  const merchants: Array<{ code: string; name: string; category: string; mfsProvider: string | null }> = [
    { code: "DARAZ",      name: "Daraz Bangladesh",     category: "SHOPPING",     mfsProvider: null },
    { code: "FLIPCART",   name: "Flipkart",             category: "SHOPPING",     mfsProvider: null },
    { code: "FOODPANDA",  name: "Foodpanda",            category: "FOOD",         mfsProvider: "BKASH" },
    { code: "UBER",       name: "Uber Bangladesh",      category: "TRANSPORT",    mfsProvider: null },
    { code: "PATHAO",     name: "Pathao",               category: "TRANSPORT",    mfsProvider: null },
    { code: "DPDC",       name: "DPDC (Power)",         category: "BILLS",        mfsProvider: null },
    { code: "WASA",       name: "DWASA (Water)",        category: "BILLS",        mfsProvider: null },
    { code: "GP",         name: "Grameenphone",         category: "BILLS",        mfsProvider: null },
    { code: "ROBI",       name: "Robi Axiata",          category: "BILLS",        mfsProvider: null },
    { code: "BKASH_BILL", name: "bKash Bill Pay",       category: "BILLS",        mfsProvider: "BKASH" },
  ];
  for (const m of merchants) {
    await prisma.merchant.upsert({
      where: { code: m.code },
      update: { name: m.name, category: m.category, mfsProvider: m.mfsProvider },
      create: m,
    });
  }
}

app.get("/api/health", async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ success: true, status: "ok", db: "reachable" });
  } catch (e) {
    const m = (e as { message?: string }).message;
    res.status(503).json({ success: false, status: "degraded", error: m });
  }
});

app.get("/api/users", async (_req, res) => {
  try {
    // Exclude the synthetic External user (id 0) — it never appears in the
    // wallet UI but participates in Transaction.senderId/receiverId for
    // off-wallet flows.
    res.json(await prisma.user.findMany({
      where: { id: { not: 0 } },
      select: { id: true, name: true, balance: true, phone: true },
      orderBy: { id: "asc" },
    }));
  } catch { fail(res, 500, "Failed to fetch users"); }
});

app.use("/api/transfer", moneyWriteLimiter, transferRouter(prisma));
app.use("/api/request", moneyWriteLimiter, requestRouter(prisma));
app.use("/api/split", moneyWriteLimiter, splitRouter(prisma));
app.use("/api/scheduled", moneyWriteLimiter, scheduledRouter(prisma));
app.use("/api/qr", moneyWriteLimiter, qrRouter(prisma));
app.use("/api/funding", moneyWriteLimiter, fundingRouter(prisma));
app.use("/api/merchant", moneyWriteLimiter, merchantRouter(prisma));
app.use("/api/refunds", moneyWriteLimiter, refundsRouter(prisma));
app.use("/api/recurring", moneyWriteLimiter, recurringRouter(prisma));
app.use("/api/fx", moneyWriteLimiter, fxRouter(prisma));
app.use("/api/contacts", contactsRouter(prisma));
app.use("/api/goals", goalsRouter(prisma));
app.use("/api", metaRouter(prisma));

app.get("/api/requests/:userId", async (req, res) => {
  const userId = Number(req.params.userId);
  if (!Number.isInteger(userId) || userId <= 0) { fail(res, 400, "Invalid user id"); return; }
  try {
    await prisma.moneyRequest.updateMany({ where: { payerId: userId, status: "PENDING", expiresAt: { lt: new Date() } }, data: { status: "EXPIRED" } });
    res.json(await prisma.moneyRequest.findMany({ where: { payerId: userId, status: "PENDING" }, orderBy: { id: "desc" }, take: 50, include: { requester: { select: { name: true, phone: true } } } }));
  } catch { fail(res, 500, "Failed to fetch requests"); }
});
app.get("/api/requests-out/:userId", async (req, res) => {
  const userId = Number(req.params.userId);
  if (!Number.isInteger(userId) || userId <= 0) { fail(res, 400, "Invalid user id"); return; }
  const rows = await prisma.moneyRequest.findMany({ where: { requesterId: userId }, orderBy: { id: "desc" }, take: 50, include: { payer: { select: { name: true, phone: true } } } });
  res.json(rows.map((x) => ({ ...x, expired: x.status === "PENDING" && isExpired(new Date(x.expiresAt)) })));
});

app.get("/api/transactions/:userId", async (req, res) => {
  const userId = Number(req.params.userId);
  if (!Number.isInteger(userId) || userId <= 0) { fail(res, 400, "Invalid user id"); return; }
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
  } catch (e) { fail(res, 500, (e as { message?: string }).message ?? "Failed"); }
});

app.post("/api/seed", async (_req, res) => {
  try {
    await ensureExternalUser();
    await ensureMerchants();
    if ((await prisma.user.count({ where: { id: { not: 0 } } })) === 0) {
      await prisma.user.createMany({ data: [
        { id: 1, name: "Alice",   balance: 10000000, phone: "+880 1712-345678" },
        { id: 2, name: "Bob",     balance: 10000000, phone: "+880 1823-456789" },
        { id: 3, name: "Charlie", balance: 10000000, phone: "+880 1934-567890" },
      ] });
      res.json({ success: true, message: "Users seeded" });
    } else res.json({ success: false, message: "Users already exist" });
  } catch (e) { fail(res, 500, (e as { message?: string }).message ?? "Request failed"); }
});

app.post("/api/admin/reset", requireAdminSecret, async (_req, res) => {
  try {
    await prisma.notification.deleteMany({});
    await prisma.contact.deleteMany({});
    await prisma.goal.deleteMany({});
    await prisma.transaction.deleteMany({});
    await prisma.moneyRequest.deleteMany({});
    await prisma.recurringInstruction.deleteMany({});
    await prisma.merchant.deleteMany({});
    // Reset the auto-increment so the demo users land back on stable IDs
    // (1=Alice, 2=Bob, 3=Charlie). External(id=0) is created first.
    await prisma.$executeRawUnsafe('ALTER SEQUENCE "User_id_seq" RESTART WITH 1');
    await prisma.user.deleteMany({});
    await prisma.user.create({
      data: { id: 0, name: "External (MFS / Bank / Merchant)", balance: 0, phone: null },
    });
    // Pinned IDs so the frontend "Select user" lookup (`users.find()` by id)
    // is deterministic across resets. The reset+sequence-reset above clears
    // any user rows above id 0.
    await prisma.user.createMany({ data: [
      { id: 1, name: "Alice",   balance: 10000000, phone: "+880 1712-345678" },
      { id: 2, name: "Bob",     balance: 10000000, phone: "+880 1823-456789" },
      { id: 3, name: "Charlie", balance: 10000000, phone: "+880 1934-567890" },
    ] });
    await ensureMerchants();
    await prisma.auditLog.create({ data: { action: "ADMIN_RESET", detail: "Demo state reset" } });
    const users = await prisma.user.findMany({
      where: { id: { not: 0 } },
      select: { id: true, name: true, balance: true, phone: true },
      orderBy: { id: "asc" },
    });
    res.json({ success: true, message: "Demo state reset", users });
  } catch (e) { fail(res, 500, (e as { message?: string }).message ?? "Request failed"); }
});

app.listen(config.port, async () => {
  console.log(`Server on port ${config.port}`);
  // Best-effort idempotent seed: External user + merchant directory. Safe
  // to run on every boot — both helpers upsert.
  try {
    await ensureExternalUser();
    await ensureMerchants();
  } catch (e) {
    console.warn("Startup seed failed:", (e as { message?: string }).message ?? e);
  }
});
