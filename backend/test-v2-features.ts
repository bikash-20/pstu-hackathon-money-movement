/**
 * v2 feature suite — security + the free fintech features added on top of the
 * original concurrency suite (test-concurrency.ts).
 *
 * Covers: rate limiting, Zod validation, per-transfer cap, daily spend
 * circuit-breaker, memos/categories, request reject + expiry, scheduled
 * transfers, QR pay-codes, contacts, goals, insights, notifications,
 * paginated history.
 *
 * WARNING: resets the database. Never point API_URL at production.
 */
import { PrismaClient } from "@prisma/client";
import { dayKey } from "./src/money.js";

const prisma = new PrismaClient();
const API_URL = process.env.API_URL || "http://localhost:4000/api";

let pass = 0;
let failed = 0;

function assert(label: string, ok: boolean, detail?: string) {
  if (ok) { pass++; console.log(`  ✅ ${label}`); }
  else { failed++; console.log(`  ❌ ${label}${detail ? ` — ${detail}` : ""}`); }
}

async function call(path: string, init?: RequestInit): Promise<{ status: number; body: any }> {
  const res = await fetch(`${API_URL}${path}`, init);
  let body: any = null;
  try { body = await res.json(); } catch { body = null; }
  return { status: res.status, body };
}

const post = (path: string, payload: unknown, key?: string) =>
  call(path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(key ? { "Idempotency-Key": key } : {}),
    },
    body: JSON.stringify(payload),
  });

let keyCounter = 0;
const key = () => `v2-${Date.now()}-${keyCounter++}`;

async function resetDb(): Promise<{ alice: any; bob: any; charlie: any }> {
  await prisma.notification.deleteMany({});
  await prisma.contact.deleteMany({});
  await prisma.goal.deleteMany({});
  await prisma.recurringInstruction.deleteMany({});
  await prisma.transaction.deleteMany({});
  await prisma.moneyRequest.deleteMany({});
  await prisma.merchant.deleteMany({});
  await prisma.user.deleteMany({});
  // Synthetic "External" user (id 0) — the off-wallet counterparty for
  // funding, merchant, refund and FX flows.
  await prisma.user.create({ data: { id: 0, name: "External", balance: 0 } });
  await prisma.user.createMany({
    data: [
      { name: "Alice",   balance: 10000000, phone: "+880 1712-345678" },
      { name: "Bob",     balance: 10000000, phone: "+880 1823-456789" },
      { name: "Charlie", balance: 10000000, phone: "+880 1934-567890" },
    ],
  });
  // Seed merchants used by /api/merchant/pay.
  await prisma.merchant.createMany({
    data: [
      { code: "DARAZ",     name: "Daraz Bangladesh",     category: "SHOPPING" },
      { code: "FLIPCART",  name: "Flipkart",             category: "SHOPPING" },
      { code: "FOODPANDA", name: "Foodpanda",            category: "FOOD",     mfsProvider: "BKASH" },
      { code: "DPDC",      name: "DPDC (Power)",         category: "BILLS" },
      { code: "GP",        name: "Grameenphone",         category: "BILLS" },
    ],
  });
  const [alice, bob, charlie] = await Promise.all(
    ["Alice", "Bob", "Charlie"].map((n) => prisma.user.findFirstOrThrow({ where: { name: n } }))
  );
  return { alice, bob, charlie };
}

// ---------- 1. Validation + error envelope ----------
async function testValidation() {
  console.log("\n--- Test 1: Zod validation & error envelope ---");
  const { alice, bob } = await resetDb();

  const self = await post("/transfer", { senderId: alice.id, receiverId: alice.id, amount: 1000 }, key());
  assert("self-transfer rejected (400)", self.status === 400, `got ${self.status}`);
  assert("self-transfer sets success:false", self.body?.success === false);
  assert("self-transfer explains why", /yourself/i.test(self.body?.error ?? ""), self.body?.error);

  const neg = await post("/transfer", { senderId: alice.id, receiverId: bob.id, amount: -5 }, key());
  assert("negative amount rejected (400)", neg.status === 400, `got ${neg.status}`);
  assert("negative amount sets success:false", neg.body?.success === false);

  const frac = await post("/transfer", { senderId: alice.id, receiverId: bob.id, amount: 10.5 }, key());
  assert("non-integer cents rejected (400)", frac.status === 400, `got ${frac.status}`);

  const noKey = await post("/transfer", { senderId: alice.id, receiverId: bob.id, amount: 1000 });
  assert("missing Idempotency-Key rejected (400)", noKey.status === 400, `got ${noKey.status}`);
  assert("missing Idempotency-Key sets success:false", noKey.body?.success === false);
}

// ---------- 2. Per-transfer cap + daily limit ----------
async function testLimits() {
  console.log("\n--- Test 2: Per-transfer cap & daily circuit-breaker ---");
  const { alice, bob } = await resetDb();

  // Top up so the daily ceiling is reachable: the seeded ৳100,000 balance is
  // smaller than the ৳200,000/day cap, so a single account could never trip it.
  await prisma.user.update({ where: { id: alice.id }, data: { balance: 30_000_000 } }); // ৳300,000

  // ৳50,000 per-transfer cap = 5,000,000 cents.
  const overCap = await post("/transfer", { senderId: alice.id, receiverId: bob.id, amount: 5_000_001 }, key());
  assert("amount above per-transfer cap rejected", overCap.status === 400, `got ${overCap.status}`);
  assert("cap error is explicit", /cap/i.test(overCap.body?.error ?? ""), overCap.body?.error);
  assert("over-cap transfer is rejected before any daily accounting",
    (await prisma.user.findUniqueOrThrow({ where: { id: alice.id } })).dailySpent === 0);

  const atCap = await post("/transfer", { senderId: alice.id, receiverId: bob.id, amount: 5_000_000 }, key());
  assert("amount exactly at cap succeeds", atCap.body?.success === true, JSON.stringify(atCap.body));

  // Daily limit is ৳200,000 = 20,000,000 cents; 4 × ৳50,000 exhausts it exactly.
  for (let i = 0; i < 3; i++) {
    const res = await post("/transfer", { senderId: alice.id, receiverId: bob.id, amount: 5_000_000 }, key());
    assert(`daily allowance tranche ${i + 2}/4 accepted`, res.body?.success === true, JSON.stringify(res.body));
  }
  const overDaily = await post("/transfer", { senderId: alice.id, receiverId: bob.id, amount: 1 }, key());
  assert("daily limit circuit-breaker trips", overDaily.body?.success === false, JSON.stringify(overDaily.body));
  assert("daily limit error is explicit", /daily limit/i.test(overDaily.body?.error ?? ""), overDaily.body?.error);
  assert("daily limit rejected even though balance is sufficient",
    (await prisma.user.findUniqueOrThrow({ where: { id: alice.id } })).balance > 1);

  const record = await prisma.user.findUniqueOrThrow({ where: { id: alice.id } });
  assert("dailySpent tracked on the user row", record.dailySpent === 20_000_000, `got ${record.dailySpent}`);
  assert("exactly 4 transfers landed (no partial 5th)", (await prisma.transaction.count({ where: { senderId: alice.id } })) === 4);

  // Settlement-day rollover: a stale window key must reset the tally, not block spend.
  await prisma.user.update({
    where: { id: alice.id },
    data: { dailyWindow: "2000-01-01" },
  });
  const nextDay = await post("/transfer", { senderId: alice.id, receiverId: bob.id, amount: 1000 }, key());
  assert("stale day window resets (rollover works)", nextDay.body?.success === true, JSON.stringify(nextDay.body));
  const rolled = await prisma.user.findUniqueOrThrow({ where: { id: alice.id } });
  assert("rollover resets the tally to just this transfer", rolled.dailySpent === 1000, `got ${rolled.dailySpent}`);
  assert("rollover re-stamps the window with today's key",
    rolled.dailyWindow === dayKey(), `got ${rolled.dailyWindow}`);
  assert("tally is not carried over from the previous day", rolled.dailySpent !== 20_001_000);
}


// ---------- 3. Memo + category pipeline ----------
async function testMemoCategory() {
  console.log("\n--- Test 3: Memo & category ---");
  const { alice, bob } = await resetDb();

  const res = await post(
    "/transfer",
    { senderId: alice.id, receiverId: bob.id, amount: 50_000, memo: "  dinner  ", category: "FOOD" },
    key()
  );
  assert("transfer with memo+category succeeds", res.body?.success === true, JSON.stringify(res.body));

  const tx = await prisma.transaction.findUniqueOrThrow({ where: { id: res.body.transactionId } });
  assert("memo persisted (trimmed)", tx.memo === "dinner", `got ${JSON.stringify(tx.memo)}`);
  assert("category persisted", tx.category === "FOOD", `got ${tx.category}`);

  const badCat = await post("/transfer", { senderId: alice.id, receiverId: bob.id, amount: 100, category: "CRYPTO" }, key());
  assert("unknown category rejected", badCat.status === 400, `got ${badCat.status}`);

  const longMemo = await post(
    "/transfer",
    { senderId: alice.id, receiverId: bob.id, amount: 100, memo: "x".repeat(141) },
    key()
  );
  assert("memo longer than 140 chars rejected", longMemo.status === 400, `got ${longMemo.status}`);

  const filtered = await call(`/transactions/${alice.id}?direction=out&category=FOOD&limit=10`);
  assert("history filters by category", filtered.body?.items?.length === 1, `got ${filtered.body?.items?.length}`);

  const searched = await call(`/transactions/${alice.id}?q=dinner`);
  assert("history full-text memo search works", searched.body?.items?.length === 1, `got ${searched.body?.items?.length}`);

  const missed = await call(`/transactions/${alice.id}?q=nonexistent-memo`);
  assert("history search excludes non-matches", missed.body?.items?.length === 0, `got ${missed.body?.items?.length}`);
}

// ---------- 4. Request lifecycle: reject + expiry + authz ----------
async function testRequestLifecycle() {
  console.log("\n--- Test 4: Money-request lifecycle (reject, expiry, authz) ---");
  const { alice, bob, charlie } = await resetDb();

  const created = await post("/request", { requesterId: alice.id, payerId: bob.id, amount: 120_000, note: "lunch" });
  assert("request created", created.body?.success === true, JSON.stringify(created.body));
  const requestId: number = created.body.requestId;

  const stored = await prisma.moneyRequest.findUniqueOrThrow({ where: { id: requestId } });
  assert("request starts PENDING", stored.status === "PENDING");
  assert("note persisted", stored.note === "lunch", `got ${JSON.stringify(stored.note)}`);
  assert("expiresAt is ~7 days out", stored.expiresAt.getTime() - Date.now() > 6 * 24 * 3600 * 1000);

  const wrongPayer = await post(`/request/${requestId}/reject`, { payerId: charlie.id });
  assert("third party cannot reject someone else's request", wrongPayer.body?.success !== true);

  const nudge = await prisma.moneyRequest.findUniqueOrThrow({ where: { id: requestId } });
  assert("unauthorized reject left request PENDING", nudge.status === "PENDING", `got ${nudge.status}`);

  const rejected = await post(`/request/${requestId}/reject`, { payerId: bob.id });
  assert("payer can reject", rejected.body?.success === true, JSON.stringify(rejected.body));

  const afterReject = await prisma.moneyRequest.findUniqueOrThrow({ where: { id: requestId } });
  assert("request marked REJECTED", afterReject.status === "REJECTED", `got ${afterReject.status}`);

  const payRejected = await post(`/request/${requestId}/pay`, { payerId: bob.id }, key());
  assert("rejected request cannot be paid", payRejected.body?.success !== true, JSON.stringify(payRejected.body));

  // Expiry: backdate a fresh request and confirm pay refuses + read lazily flips status.
  const expiring = await post("/request", { requesterId: alice.id, payerId: bob.id, amount: 5000 });
  const expiringId: number = expiring.body.requestId;
  await prisma.moneyRequest.update({
    where: { id: expiringId },
    data: { expiresAt: new Date(Date.now() - 60_000) },
  });

  const payExpired = await post(`/request/${expiringId}/pay`, { payerId: bob.id }, key());
  assert("expired request cannot be paid", payExpired.body?.success !== true, JSON.stringify(payExpired.body));
  assert("expiry error is explicit", /expired/i.test(payExpired.body?.error ?? ""), payExpired.body?.error);

  const inbox = await call(`/requests/${bob.id}`);
  assert("expired request removed from payer inbox", (inbox.body ?? []).length === 0, `got ${(inbox.body ?? []).length}`);

  const expiredRow = await prisma.moneyRequest.findUniqueOrThrow({ where: { id: expiringId } });
  assert("status lazily flipped to EXPIRED", expiredRow.status === "EXPIRED", `got ${expiredRow.status}`);

  const bobAfter = await prisma.user.findUniqueOrThrow({ where: { id: bob.id } });
  assert("no money moved on reject/expire", bobAfter.balance === 10_000_000, `got ${bobAfter.balance}`);
}

// ---------- 5. Scheduled transfers ----------
async function testScheduled() {
  console.log("\n--- Test 5: Scheduled transfers ---");
  const { alice, bob } = await resetDb();

  const past = await post(
    "/scheduled",
    { senderId: alice.id, receiverId: bob.id, amount: 5000, executeAt: new Date(Date.now() - 60_000).toISOString() },
    key()
  );
  assert("past executeAt rejected", past.status === 400, `got ${past.status}`);

  const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  const created = await post("/scheduled", { senderId: alice.id, receiverId: bob.id, amount: 5000, executeAt: future }, key());
  assert("future schedule accepted", created.body?.success === true, JSON.stringify(created.body));
  const scheduledId: number = created.body.scheduledId;

  const scheduledRow = await prisma.transaction.findUniqueOrThrow({ where: { id: scheduledId } });
  assert("scheduled row is not yet COMPLETED", scheduledRow.status.startsWith("SCHEDULED:"));

  const early = await post("/scheduled/settle", {});
  assert("settle skips not-yet-due rows", early.body?.settled === 0 && early.body?.skipped >= 1, JSON.stringify(early.body));

  const balanceBefore = (await prisma.user.findUniqueOrThrow({ where: { id: alice.id } })).balance;
  assert("no money moved before due time", balanceBefore === 10_000_000, `got ${balanceBefore}`);

  // Make it due, then settle.
  await prisma.transaction.update({
    where: { id: scheduledId },
    data: { status: `SCHEDULED:${new Date(Date.now() - 1000).toISOString()}` },
  });
  const settled = await post("/scheduled/settle", {});
  assert("settle processes due rows", settled.body?.settled === 1, JSON.stringify(settled.body));

  const aliceAfter = (await prisma.user.findUniqueOrThrow({ where: { id: alice.id } })).balance;
  const bobAfter = (await prisma.user.findUniqueOrThrow({ where: { id: bob.id } })).balance;
  assert("initiator debited", aliceAfter === 10_000_000 - 5000, `got ${aliceAfter}`);
  assert("recipient credited", bobAfter === 10_000_000 + 5000, `got ${bobAfter}`);
  assert("row flipped to COMPLETED",
    (await prisma.transaction.findUniqueOrThrow({ where: { id: scheduledId } })).status === "COMPLETED");

  const listed = await call(`/scheduled/${alice.id}`);
  assert("no lingering scheduled rows", (listed.body ?? []).length === 0, `got ${(listed.body ?? []).length}`);
}

// ---------- 6. QR pay-codes ----------
async function testQr() {
  console.log("\n--- Test 6: QR pay-codes ---");
  const { alice, bob } = await resetDb();

  const badIssue = await post("/qr/issue", { receiverId: bob.id, amount: -1 });
  assert("QR issue rejects non-positive amount", badIssue.status === 400, `got ${badIssue.status}`);

  const issued = await post("/qr/issue", { receiverId: bob.id, amount: 25_000 });
  assert("QR issued", issued.body?.success === true, JSON.stringify(issued.body));
  const code: string = issued.body.code;
  assert("code encodes receiver + amount", code.startsWith(`pstuqr.${bob.id}.25000.`), code);

  const audit = await prisma.auditLog.findFirst({ where: { action: "QR_ISSUE", detail: code } });
  assert("QR issue is audited", audit !== null);

  const self = await post("/qr/redeem", { senderId: bob.id, code }, key());
  assert("self-redeem rejected", self.body?.success !== true);

  const malformed = await post("/qr/redeem", { senderId: alice.id, code: "not-a-code" }, key());
  assert("malformed code rejected", malformed.status === 400, `got ${malformed.status}`);

  const redeemKey = key();
  const redeem = await post("/qr/redeem", { senderId: alice.id, code }, redeemKey);
  assert("QR redeemed", redeem.body?.success === true, JSON.stringify(redeem.body));

  const aliceAfter = (await prisma.user.findUniqueOrThrow({ where: { id: alice.id } })).balance;
  const bobAfter = (await prisma.user.findUniqueOrThrow({ where: { id: bob.id } })).balance;
  assert("redeemer debited", aliceAfter === 10_000_000 - 25_000, `got ${aliceAfter}`);
  assert("issuer credited", bobAfter === 10_000_000 + 25_000, `got ${bobAfter}`);

  // Same Idempotency-Key, same code: must be a cached replay, never a second debit.
  const replay = await post("/qr/redeem", { senderId: alice.id, code }, redeemKey);
  assert("replay returns the original transaction", replay.body?.transactionId === redeem.body.transactionId,
    JSON.stringify({ first: redeem.body, replay: replay.body }));
  assert("replay is flagged as cached", /cached/i.test(replay.body?.message ?? ""), replay.body?.message);

  const aliceAfterReplay = (await prisma.user.findUniqueOrThrow({ where: { id: alice.id } })).balance;
  assert("no extra debit on replay", aliceAfterReplay === aliceAfter, `got ${aliceAfterReplay}`);
  assert("exactly one QR ledger row exists",
    (await prisma.transaction.count({ where: { idempotencyKey: redeemKey } })) === 1);

  // A *fresh* key paying an already-redeemed code is a legitimate new payment
  // (the code string is not single-use), so the debit is expected to land.
  const freshKey = await post("/qr/redeem", { senderId: alice.id, code }, key());
  assert("fresh key against the same code is a new payment, not a replay",
    freshKey.body?.success === true && freshKey.body?.transactionId !== redeem.body.transactionId,
    JSON.stringify(freshKey.body));
}

// ---------- 7. Contacts, goals, insights, notifications ----------
async function testContactsGoalsInsights() {
  console.log("\n--- Test 7: Contacts, savings goals, insights, notifications ---");
  const { alice, bob } = await resetDb();

  const saved = await post("/contacts", { ownerId: alice.id, contactId: bob.id, nickname: "Bobby" });
  assert("contact saved", saved.body?.success === true, JSON.stringify(saved.body));

  const dupe = await post("/contacts", { ownerId: alice.id, contactId: bob.id });
  assert("duplicate contact rejected", dupe.body?.success !== true);

  const selfContact = await post("/contacts", { ownerId: alice.id, contactId: alice.id });
  assert("cannot save yourself as a payee", selfContact.body?.success !== true);

  const list = await call(`/contacts/${alice.id}`);
  assert("contact list enriched with user", list.body?.[0]?.contact?.name === "Bob", JSON.stringify(list.body?.[0]));

  const goal = await post("/goals", { userId: alice.id, name: "Eid trip", targetAmount: 100_000 });
  assert("goal created", goal.body?.success === true, JSON.stringify(goal.body));
  const goalId: number = goal.body.goal.id;

  const deposit = await post(`/goals/${goalId}/deposit`, { userId: alice.id, amount: 60_000 }, key());
  assert("goal deposit accepted", deposit.body?.success === true, JSON.stringify(deposit.body));
  assert("goal progress tracked", deposit.body?.goal?.savedAmount === 60_000, `got ${deposit.body?.goal?.savedAmount}`);

  const aliceMid = (await prisma.user.findUniqueOrThrow({ where: { id: alice.id } })).balance;
  assert("deposit debits spendable balance", aliceMid === 10_000_000 - 60_000, `got ${aliceMid}`);

  const ledgerRow = await prisma.transaction.findFirst({
    where: { senderId: alice.id, receiverId: alice.id, category: "SAVINGS" },
  });
  assert("deposit writes a SAVINGS ledger row", ledgerRow?.amount === 60_000, JSON.stringify(ledgerRow?.amount));

  const completing = await post(`/goals/${goalId}/deposit`, { userId: alice.id, amount: 40_000 }, key());
  assert("goal completes at target", completing.body?.goal?.completedAt !== null, JSON.stringify(completing.body?.goal));

  const doneNotif = await prisma.notification.findFirst({ where: { userId: alice.id, kind: "GOAL_DONE" } });
  assert("goal completion notifies the owner", doneNotif !== null);

  const afterComplete = await post(`/goals/${goalId}/deposit`, { userId: alice.id, amount: 100 }, key());
  assert("completed goal refuses further deposits", afterComplete.body?.success !== true);

  // Insights need COMPLETED outgoing activity.
  await post("/transfer", { senderId: alice.id, receiverId: bob.id, amount: 30_000, category: "FOOD" }, key());
  await post("/transfer", { senderId: alice.id, receiverId: bob.id, amount: 10_000, category: "TRANSPORT" }, key());

  const insights = await call(`/insights/${alice.id}?days=30`);
  assert("insights returns a breakdown", Array.isArray(insights.body?.breakdown), JSON.stringify(insights.body));
  const food = insights.body.breakdown.find((b: any) => b.category === "FOOD");
  assert("insights aggregate the FOOD bucket", food?.total === 30_000, JSON.stringify(food));
  const pctSum = insights.body.breakdown.reduce((s: number, b: any) => s + b.pct, 0);
  assert("category percentages roughly sum to 100", pctSum >= 99 && pctSum <= 101, `got ${pctSum}`);

  const notifs = await call(`/notifications/${alice.id}`);
  assert("notification inbox populated", (notifs.body ?? []).length > 0, `got ${(notifs.body ?? []).length}`);

  await post(`/notifications/${alice.id}/read-all`, {});
  const unread = await call(`/notifications/${alice.id}?unread=1`);
  assert("read-all clears the unread badge", (unread.body ?? []).length === 0, `got ${(unread.body ?? []).length}`);
}

// ---------- 8. Pagination + rate limiting ----------
async function testPaginationAndRateLimit() {
  console.log("\n--- Test 8: Pagination & rate limiting ---");
  const { alice, bob } = await resetDb();

  // 8 transfers so pagination has something to page through.
  for (let i = 0; i < 8; i++) {
    await post("/transfer", { senderId: alice.id, receiverId: bob.id, amount: 1000 + i, memo: `tx-${i}` }, key());
  }

  const first = await call(`/transactions/${alice.id}?limit=3&direction=out`);
  assert("page size honoured", first.body?.items?.length === 3, `got ${first.body?.items?.length}`);
  assert("nextCursor returned when more remain", typeof first.body?.nextCursor === "number", JSON.stringify(first.body?.nextCursor));

  const second = await call(`/transactions/${alice.id}?limit=3&direction=out&cursor=${first.body.nextCursor}`);
  const firstIds = first.body.items.map((t: any) => t.id);
  const secondIds = second.body.items.map((t: any) => t.id);
  assert("second page returns fresh rows", secondIds.every((id: number) => !firstIds.includes(id)), JSON.stringify({ firstIds, secondIds }));
  assert("pages are ordered newest-first", firstIds[0] > secondIds[0], JSON.stringify({ firstIds, secondIds }));

  const capped = await call(`/transactions/${alice.id}?limit=9999&direction=out`);
  assert("limit is clamped to 100", (capped.body?.items?.length ?? 0) <= 100);

  const directionIn = await call(`/transactions/${bob.id}?direction=in`);
  assert("direction=in returns only credits", directionIn.body.items.every((t: any) => t.receiverId === bob.id));

  // Rate limit: 30 money writes/min per (ip+user). Fire 40 and expect some 429s.
  let throttled = 0;
  let allowed = 0;
  for (let i = 0; i < 40; i++) {
    const res = await post("/transfer", { senderId: bob.id, receiverId: alice.id, amount: 1 }, key());
    if (res.status === 429) throttled++;
    else allowed++;
  }
  assert("rate limiter throttles sustained bursts", throttled > 0, `throttled=${throttled}`);
  assert("rate limiter still allows normal traffic", allowed > 0, `allowed=${allowed}`);

  // Hammer once more and check that the 429 body matches the new envelope.
  const rlBody = await post("/transfer", { senderId: bob.id, receiverId: alice.id, amount: 1 }, key());
  assert("429 body carries success:false", rlBody.body?.success === false, JSON.stringify(rlBody.body));
  assert("429 body explains the limit", /too many/i.test(rlBody.body?.error ?? ""), rlBody.body?.error);
}

// ---------- 9. Security headers ----------
async function testHeaders() {
  console.log("\n--- Test 9: Security headers ---");
  const res = await fetch(`${API_URL}/health`);
  assert("helmet sets x-content-type-options", res.headers.get("x-content-type-options") === "nosniff");
  assert("helmet sets x-frame-options", res.headers.get("x-frame-options") !== null, String(res.headers.get("x-frame-options")));
  assert("helmet hides x-powered-by", res.headers.get("x-powered-by") === null);
  assert("rate-limit headers exposed", res.headers.get("ratelimit-limit") !== null || res.headers.get("ratelimit") !== null);
}

// ---------- 10. Audit trail ----------
async function testAudit() {
  console.log("\n--- Test 10: Audit trail & admin guard ---");
  const log = await prisma.auditLog.findFirst({ where: { action: "ADMIN_RESET" }, orderBy: { id: "desc" } });
  assert("reset endpoint writes an audit entry", log !== null);

  const reset = await post("/admin/reset", {});
  // After admin reset: 3 demo users (Alice/Bob/Charlie) + External(id=0), but
  // the public /api/users listing excludes External so the response array
  // contains exactly 3 entries.
  assert("admin reset restores the demo state", reset.body?.users?.length === 3, JSON.stringify(reset.body?.users?.length));

  const fresh = await prisma.user.findMany({ where: { id: { not: 0 } }, orderBy: { id: "asc" } });
  assert("reset reseeds all three balances at ৳100,000",
    fresh.every((u) => u.balance === 10_000_000), JSON.stringify(fresh.map((u) => u.balance)));
  assert("reset clears the ledger", (await prisma.transaction.count()) === 0);
  assert("reset clears standing instructions", (await prisma.recurringInstruction.count()) === 0);
  assert("reset re-seeds the merchant directory", (await prisma.merchant.count()) >= 5);

  const adminSecret = process.env.ADMIN_SECRET;
  if (adminSecret) {
    const forbidden = await fetch(`${API_URL}/admin/reset`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    assert("admin reset rejects a missing secret when configured", forbidden.status === 403, `got ${forbidden.status}`);
  } else {
    console.log("  ℹ️  ADMIN_SECRET not set — skipping secret-guard assertion (endpoint is open by design in demo mode)");
  }
}

// ---------- 11. Funding: Add Money + Cash Out ----------
async function testFunding() {
  console.log("\n--- Test 11: Funding rails (Add Money + Cash Out) ---");
  const { alice, bob } = await resetDb();

  const src = await call("/funding/sources");
  assert("/funding/sources lists rails", Array.isArray(src.body?.sources) && src.body.sources.includes("BKASH"));

  // Add ৳5,000 from BKASH → balance +500000, category FUNDING.
  const add = await post("/funding/add", { userId: alice.id, amount: 500000, source: "BKASH" }, key());
  assert("add money succeeds (200)", add.status === 200, `got ${add.status}`);
  const aliceAfterAdd = await prisma.user.findUnique({ where: { id: alice.id } });
  assert("add money credits the wallet", aliceAfterAdd?.balance === 10_500_000, JSON.stringify(aliceAfterAdd?.balance));
  const fundRow = await prisma.transaction.findFirst({ where: { receiverId: alice.id, category: "FUNDING" }, orderBy: { id: "desc" } });
  assert("ledger row has category FUNDING", fundRow?.category === "FUNDING");
  assert("ledger row sender is External (id 0)", fundRow?.senderId === 0);

  // Withdraw ৳3,000 to NAGAD → balance -300000, category WITHDRAWAL.
  const wd = await post("/funding/withdraw", { userId: alice.id, amount: 300000, destination: "NAGAD" }, key());
  assert("withdraw succeeds (200)", wd.status === 200, `got ${wd.status}`);
  const aliceAfterWd = await prisma.user.findUnique({ where: { id: alice.id } });
  assert("withdraw debits the wallet", aliceAfterWd?.balance === 10_200_000, JSON.stringify(aliceAfterWd?.balance));
  const wdRow = await prisma.transaction.findFirst({ where: { senderId: alice.id, category: "WITHDRAWAL" }, orderBy: { id: "desc" } });
  assert("ledger row has category WITHDRAWAL", wdRow?.category === "WITHDRAWAL");
  assert("ledger row receiver is External (id 0)", wdRow?.receiverId === 0);

  // Idempotent replay returns the cached row.
  const replay = await post("/funding/add", { userId: alice.id, amount: 500000, source: "BKASH" }, key());
  // Different idempotency key above (key() returns a fresh one each time).
  // Use a stable key here:
  const stableKey = `funding-replay-${Date.now()}`;
  await post("/funding/add", { userId: alice.id, amount: 12345, source: "BANK" }, stableKey);
  const dup = await post("/funding/add", { userId: alice.id, amount: 12345, source: "BANK" }, stableKey);
  assert("idempotent replay returns cached row", /cached/i.test(dup.body?.message ?? ""), dup.body?.message);

  // Unknown source rejected by Zod.
  const bad = await post("/funding/add", { userId: alice.id, amount: 100, source: "PAYPAL" }, key());
  assert("unknown source rejected (400)", bad.status === 400, `got ${bad.status}`);

  // Suppress unused vars warning.
  void bob; void replay;
}

// ---------- 12. Merchant checkout ----------
async function testMerchantPay() {
  console.log("\n--- Test 12: Merchant checkout ---");
  const { alice } = await resetDb();

  const list = await call("/merchant");
  assert("/merchant lists seeded entries", Array.isArray(list.body?.merchants) && list.body.merchants.length >= 5, JSON.stringify(list.body?.merchants?.length));
  const hasDaraz = list.body?.merchants?.some((m: any) => m.code === "DARAZ");
  assert("merchant list includes DARAZ", hasDaraz);

  const one = await call("/merchant/DARAZ");
  assert("/merchant/:code returns one row", one.body?.merchant?.code === "DARAZ");

  const pay = await post("/merchant/pay", { userId: alice.id, merchantCode: "DARAZ", amount: 250000, orderRef: "INV-1" }, key());
  assert("merchant pay succeeds (200)", pay.status === 200, `got ${pay.status}`);
  const row = await prisma.transaction.findFirst({ where: { senderId: alice.id, category: "MERCHANT" }, orderBy: { id: "desc" } });
  assert("ledger row has category MERCHANT", row?.category === "MERCHANT");
  assert("ledger row has merchantCode DARAZ", row?.merchantCode === "DARAZ");
  assert("ledger memo includes orderRef", /INV-1/.test(row?.memo ?? ""), row?.memo ?? undefined);

  // Unknown merchant code rejected.
  const bad = await post("/merchant/pay", { userId: alice.id, merchantCode: "FAKECOMPANY", amount: 100 }, key());
  assert("unknown merchant rejected (404)", bad.status === 404, `got ${bad.status}`);
}

// ---------- 13. Refund flow ----------
async function testRefund() {
  console.log("\n--- Test 13: Refund flow ---");
  const { alice, bob } = await resetDb();

  // Alice sends Bob ৳500.
  const xfer = await post("/transfer", { senderId: alice.id, receiverId: bob.id, amount: 50000, memo: "Refund test" }, key());
  assert("seed transfer succeeds", xfer.status === 200, `got ${xfer.status}`);
  const txId = xfer.body?.transactionId;
  assert("returned a transactionId", typeof txId === "number", JSON.stringify(txId));

  const aliceBefore = (await prisma.user.findUnique({ where: { id: alice.id } }))?.balance ?? 0;
  const bobBefore   = (await prisma.user.findUnique({ where: { id: bob.id } }))?.balance ?? 0;

  // Alice (original sender) refunds.
  const refund = await post("/refunds", { originalId: txId, requesterId: alice.id }, key());
  assert("refund succeeds (200)", refund.status === 200, `got ${refund.status}`);

  const aliceAfter = (await prisma.user.findUnique({ where: { id: alice.id } }))?.balance ?? 0;
  const bobAfter   = (await prisma.user.findUnique({ where: { id: bob.id } }))?.balance ?? 0;
  assert("refund credits the sender", aliceAfter === aliceBefore + 50000, `Δ=${aliceAfter - aliceBefore}`);
  assert("refund debits the receiver", bobAfter === bobBefore - 50000, `Δ=${bobAfter - bobBefore}`);

  const original = await prisma.transaction.findUnique({ where: { id: txId } });
  assert("original row status flipped to REFUNDED", original?.status === "REFUNDED");
  const refundRow = await prisma.transaction.findFirst({ where: { category: "REFUND", memo: { contains: `Refund of #${txId}` } } });
  assert("refund row exists with category REFUND", refundRow?.category === "REFUND");

  // Double-refund rejected.
  const dup = await post("/refunds", { originalId: txId, requesterId: alice.id }, key());
  assert("double-refund rejected (400)", dup.status === 400, `got ${dup.status}`);

  // Refund by non-sender rejected (Bob trying to refund Alice's transfer to himself).
  const bobRefund = await post("/refunds", { originalId: txId, requesterId: bob.id }, key());
  assert("refund by non-sender rejected (403)", bobRefund.status === 403, `got ${bobRefund.status}`);
}

// ---------- 14. Recurring / standing instructions ----------
async function testRecurring() {
  console.log("\n--- Test 14: Recurring instructions ---");
  const { alice, bob } = await resetDb();

  const future = new Date(Date.now() + 86_400_000).toISOString();
  const create = await post("/recurring", { userId: alice.id, recipientId: bob.id, amount: 100000, cadence: "MONTHLY", startAt: future, memo: "Rent" }, key());
  assert("recurring instruction created", create.status === 200, `got ${create.status}`);
  const instrId = create.body?.instruction?.id;
  assert("instruction id returned", typeof instrId === "number");

  const list = await call(`/recurring/${alice.id}`);
  assert("/recurring/:uid lists the instruction", Array.isArray(list.body) && list.body.length === 1, JSON.stringify(list.body?.length));

  // Settle should be a no-op (instruction not due yet — first run is tomorrow).
  const settle = await post("/recurring/settle", {});
  assert("/recurring/settle responds", settle.status === 200, `got ${settle.status}`);
  // Materialize into SCHEDULED rows for an instruction due *now*.
  await prisma.recurringInstruction.update({ where: { id: instrId }, data: { nextRunAt: new Date(Date.now() - 1000) } });
  const settled = await post("/recurring/settle", {});
  assert("settle materializes a due instruction", settled.body?.materialized >= 1, JSON.stringify(settled.body));

  // Cancel.
  const cancel = await call(`/recurring/${instrId}`, { method: "DELETE" });
  assert("cancel succeeds", cancel.status === 200);
  const after = await prisma.recurringInstruction.findUnique({ where: { id: instrId } });
  assert("instruction is inactive after cancel", after?.active === false);

  // Cadence future-date validation.
  const past = await post("/recurring", { userId: alice.id, recipientId: bob.id, amount: 100, cadence: "DAILY", startAt: new Date(Date.now() - 1000).toISOString() }, key());
  assert("past startAt rejected (400)", past.status === 400, `got ${past.status}`);
}

// ---------- 15. FX / multi-currency ----------
async function testFx() {
  console.log("\n--- Test 15: FX / multi-currency transfer ---");
  const { alice, bob } = await resetDb();

  const rates = await call("/fx/rates");
  assert("/fx/rates returns table", typeof rates.body?.rates?.USD === "number", JSON.stringify(rates.body?.rates));

  const xfer = await post("/fx/transfer", { senderId: alice.id, receiverId: bob.id, amountForeign: 10, currency: "USD", memo: "FX demo" }, key());
  assert("FX transfer succeeds (200)", xfer.status === 200, `got ${xfer.status}`);

  const row = await prisma.transaction.findFirst({ where: { senderId: alice.id, category: "FX" }, orderBy: { id: "desc" } });
  assert("ledger row has category FX", row?.category === "FX");
  assert("ledger row carries currency USD", row?.currency === "USD");
  // 10 USD × 110 BDT/USD = ৳1,100 = 110000 cents.
  assert("BDT amount computed from rate", row?.amount === 110000, JSON.stringify(row?.amount));
  assert("memo carries the foreign amount + currency", /10 USD/.test(row?.memo ?? ""), row?.memo ?? undefined);

  // Self FX rejected.
  const self = await post("/fx/transfer", { senderId: alice.id, receiverId: alice.id, amountForeign: 1, currency: "USD" }, key());
  assert("self FX rejected (400)", self.status === 400, `got ${self.status}`);
}

async function runAll() {
  console.log("=== PSTU Money Movement v2 — Feature & Security Suite ===");
  console.log(`API: ${API_URL}`);
  console.log("NOTE: This script resets the database. Do NOT run against the deployed Render DB.");

  const suites = [
    testValidation,
    testLimits,
    testMemoCategory,
    testRequestLifecycle,
    testScheduled,
    testQr,
    testContactsGoalsInsights,
    testPaginationAndRateLimit,
    testHeaders,
    testAudit,
    // ── external-payments-v3 ──────────────────────────────────────────────
    testFunding,
    testMerchantPay,
    testRefund,
    testRecurring,
    testFx,
  ];

  for (const suite of suites) {
    try { await suite(); }
    catch (err) { failed++; console.error(`  ⚠️  suite crashed: ${(err as Error).message}`); }
  }

  console.log(`\n=== Result: ${pass} passed, ${failed} failed ===`);
  await prisma.$disconnect();
  process.exit(failed === 0 ? 0 : 1);
}

runAll();
