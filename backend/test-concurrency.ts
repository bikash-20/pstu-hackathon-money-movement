import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const API_URL = process.env.API_URL || 'http://localhost:4000/api';

let passCount = 0;
let failCount = 0;

function assert(label: string, condition: boolean, detail?: string) {
  if (condition) {
    passCount++;
    console.log(`  ✅ ${label}`);
  } else {
    failCount++;
    console.log(`  ❌ ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

async function resetDb() {
  await prisma.transaction.deleteMany({});
  await prisma.moneyRequest.deleteMany({});
  await prisma.user.deleteMany({});
  return prisma.user.createMany({
    data: [
      { name: 'Alice',   balance: 10000000 }, // ৳100,000
      { name: 'Bob',     balance: 10000000 },
      { name: 'Charlie', balance: 10000000 },
      { name: 'Dora',    balance: 0 }
    ]
  });
}

// =====================================================
// TEST 1 — original concurrent-transfer / pessimistic lock
// =====================================================
async function testConcurrentTransfer() {
  console.log('\n--- Test 1: Concurrent Transfer (pessimistic lock) ---');
  await resetDb();

  const alice = await prisma.user.create({ data: { name: 'LockAlice', balance: 500 } }); // 5 BDT
  const bob   = await prisma.user.create({ data: { name: 'LockBob',   balance: 0   } });

  const promises = [];
  for (let i = 0; i < 5; i++) {
    promises.push(
      fetch(`${API_URL}/transfer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `lock-test-${i}-${Date.now()}` },
        body: JSON.stringify({ senderId: alice.id, receiverId: bob.id, amount: 500 })
      }).then(r => r.json())
    );
  }
  const results = await Promise.all(promises);
  const successes = results.filter(r => r.success).length;
  const failures  = results.filter(r => !r.success).length;

  const finalAlice = await prisma.user.findUnique({ where: { id: alice.id } });
  const finalBob   = await prisma.user.findUnique({ where: { id: bob.id } });

  assert('exactly 1 of 5 concurrent transfers succeeded', successes === 1, `got ${successes}`);
  assert('exactly 4 of 5 concurrent transfers failed',    failures  === 4, `got ${failures}`);
  assert('Alice final balance is 0 (no double-spend)',    finalAlice?.balance === 0, `got ${finalAlice?.balance}`);
  assert('Bob final balance is 500',                      finalBob?.balance   === 500, `got ${finalBob?.balance}`);
}

// =====================================================
// TEST 2 — Split Bill: happy path (even split, exact division)
// =====================================================
async function testSplitHappyPath() {
  console.log('\n--- Test 2: Split Bill — Happy Path ---');
  await resetDb();
  const alice = await prisma.user.findFirst({ where: { name: 'Alice' } });
  const bob   = await prisma.user.findFirst({ where: { name: 'Bob' } });
  const charlie = await prisma.user.findFirst({ where: { name: 'Charlie' } });
  if (!alice || !bob || !charlie) throw new Error('seed users missing');

  const key = `split-happy-${Date.now()}`;
  const res = await fetch(`${API_URL}/split`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key },
    body: JSON.stringify({
      initiatorId: alice.id,
      recipientIds: [bob.id, charlie.id],
      totalAmount: 150000 // ৳1,500
    })
  }).then(r => r.json());

  const aliceAfter  = await prisma.user.findUnique({ where: { id: alice.id } });
  const bobAfter    = await prisma.user.findUnique({ where: { id: bob.id } });
  const charlieAfter = await prisma.user.findUnique({ where: { id: charlie.id } });

  const legs = await prisma.transaction.findMany({
    where: { idempotencyKey: { startsWith: `${key}:leg:` } }
  });

  assert('split succeeded',              res.success === true);
  assert('Alice debited ৳1,500',         aliceAfter?.balance === 10000000 - 150000);
  assert('Bob credited ৳750',            bobAfter?.balance === 10000000 + 75000);
  assert('Charlie credited ৳750',        charlieAfter?.balance === 10000000 + 75000);
  assert('exactly 2 transaction legs',   legs.length === 2);
}

// =====================================================
// TEST 3 — Split Bill: insufficient funds (atomic rollback)
// =====================================================
async function testSplitInsufficientFunds() {
  console.log('\n--- Test 3: Split Bill — Insufficient Funds (rollback) ---');
  await resetDb();
  const alice = await prisma.user.findFirst({ where: { name: 'Alice' } });
  const bob   = await prisma.user.findFirst({ where: { name: 'Bob' } });
  const charlie = await prisma.user.findFirst({ where: { name: 'Charlie' } });
  if (!alice || !bob || !charlie) throw new Error('seed users missing');

  const key = `split-insufficient-${Date.now()}`;
  const res = await fetch(`${API_URL}/split`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key },
    body: JSON.stringify({
      initiatorId: alice.id,
      recipientIds: [bob.id, charlie.id],
      totalAmount: 10000001 // ৳100,000.01 — Alice only has ৳100,000
    })
  }).then(r => r.json());

  const aliceAfter  = await prisma.user.findUnique({ where: { id: alice.id } });
  const bobAfter    = await prisma.user.findUnique({ where: { id: bob.id } });
  const charlieAfter = await prisma.user.findUnique({ where: { id: charlie.id } });
  const legs = await prisma.transaction.findMany({
    where: { idempotencyKey: { startsWith: `${key}:leg:` } }
  });

  assert('split rejected',                       res.success === false);
  assert('error mentions insufficient funds',     /insufficient/i.test(res.error || ''));
  assert('Alice balance unchanged',              aliceAfter?.balance === 10000000);
  assert('Bob balance unchanged',                bobAfter?.balance === 10000000);
  assert('Charlie balance unchanged',            charlieAfter?.balance === 10000000);
  assert('no transaction legs written',          legs.length === 0);
}

// =====================================================
// TEST 4 — Split Bill: unknown recipient (atomic rollback)
// =====================================================
async function testSplitUnknownRecipient() {
  console.log('\n--- Test 4: Split Bill — Unknown Recipient (rollback) ---');
  await resetDb();
  const alice = await prisma.user.findFirst({ where: { name: 'Alice' } });
  const bob   = await prisma.user.findFirst({ where: { name: 'Bob' } });
  if (!alice || !bob) throw new Error('seed users missing');

  const key = `split-unknown-${Date.now()}`;
  const res = await fetch(`${API_URL}/split`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key },
    body: JSON.stringify({
      initiatorId: alice.id,
      recipientIds: [bob.id, 99999], // 99999 doesn't exist
      totalAmount: 50000
    })
  }).then(r => r.json());

  const aliceAfter = await prisma.user.findUnique({ where: { id: alice.id } });
  const bobAfter   = await prisma.user.findUnique({ where: { id: bob.id } });
  const legs = await prisma.transaction.findMany({
    where: { idempotencyKey: { startsWith: `${key}:leg:` } }
  });

  assert('split rejected',             res.success === false);
  assert('error mentions not found',   /not found/i.test(res.error || ''));
  assert('Alice balance unchanged',    aliceAfter?.balance === 10000000);
  assert('Bob balance unchanged',      bobAfter?.balance === 10000000);
  assert('no transaction legs written',legs.length === 0);
}

// =====================================================
// TEST 5 — Split Bill: remainder rule (৳1,000 across 3 people = 333.34/333.33/333.33)
// =====================================================
async function testSplitRemainderRule() {
  console.log('\n--- Test 5: Split Bill — Remainder Rule ---');
  await resetDb();
  const alice = await prisma.user.findFirst({ where: { name: 'Alice' } });
  const bob   = await prisma.user.findFirst({ where: { name: 'Bob' } });
  const charlie = await prisma.user.findFirst({ where: { name: 'Charlie' } });
  const dora  = await prisma.user.findFirst({ where: { name: 'Dora' } });
  if (!alice || !bob || !charlie || !dora) throw new Error('seed users missing');

  const key = `split-remainder-${Date.now()}`;
  const res = await fetch(`${API_URL}/split`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key },
    body: JSON.stringify({
      initiatorId: alice.id,
      recipientIds: [bob.id, charlie.id, dora.id], // Bob is first → gets the extra cent
      totalAmount: 100000 // ৳1,000 = 100,000 cents, 100000 % 3 = 1
    })
  }).then(r => r.json());

  const legs = await prisma.transaction.findMany({
    where: { idempotencyKey: { startsWith: `${key}:leg:` } },
    orderBy: { id: 'asc' }
  });

  const totalLegAmount = legs.reduce((sum, l) => sum + l.amount, 0);

  assert('split succeeded',              res.success === true);
  assert('3 transaction legs written',   legs.length === 3);
  assert('sum of legs equals totalAmount (100,000 cents)', totalLegAmount === 100000, `got ${totalLegAmount}`);
  assert('first recipient (Bob) got the extra cent (33,334 cents)',
    legs[0]?.amount === 33334, `got ${legs[0]?.amount}`);
  assert('second recipient (Charlie) got floor share (33,333 cents)',
    legs[1]?.amount === 33333, `got ${legs[1]?.amount}`);
  assert('third recipient (Dora) got floor share (33,333 cents)',
    legs[2]?.amount === 33333, `got ${legs[2]?.amount}`);
}

// =====================================================
// TEST 6 — Split Bill: idempotent replay (same key, second call is a no-op)
// =====================================================
async function testSplitIdempotentReplay() {
  console.log('\n--- Test 6: Split Bill — Idempotent Replay ---');
  await resetDb();
  const alice = await prisma.user.findFirst({ where: { name: 'Alice' } });
  const bob   = await prisma.user.findFirst({ where: { name: 'Bob' } });
  if (!alice || !bob) throw new Error('seed users missing');

  const key = `split-replay-${Date.now()}`;
  const body = JSON.stringify({
    initiatorId: alice.id,
    recipientIds: [bob.id],
    totalAmount: 100000 // ৳1,000
  });
  const opts = (idempotencyKey: string) => ({
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
    body
  });

  const first  = await fetch(`${API_URL}/split`, opts(key)).then(r => r.json());
  const second = await fetch(`${API_URL}/split`, opts(key)).then(r => r.json());

  const legs = await prisma.transaction.findMany({
    where: { idempotencyKey: { startsWith: `${key}:leg:` } }
  });

  assert('first call succeeded',                first.success === true);
  assert('second call succeeded (cached)',      second.success === true);
  assert('second call marked as cached',        /cached/i.test(second.message || ''));
  assert('still exactly 1 transaction leg',     legs.length === 1, `got ${legs.length}`);
}

async function runAll() {
  console.log('=== PSTU Money Movement — Test Suite ===');
  console.log(`API: ${API_URL}`);
  console.log('NOTE: This script resets the database. Do NOT run against the deployed Render DB.');

  try {
    await testConcurrentTransfer();
    await testSplitHappyPath();
    await testSplitInsufficientFunds();
    await testSplitUnknownRecipient();
    await testSplitRemainderRule();
    await testSplitIdempotentReplay();
  } catch (err) {
    console.error('Test runner crashed:', err);
    failCount++;
  }

  console.log(`\n=== Result: ${passCount} passed, ${failCount} failed ===`);
  process.exit(failCount === 0 ? 0 : 1);
}

runAll();