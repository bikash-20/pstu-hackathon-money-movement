import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const API_URL = 'http://localhost:4000/api';

async function runTest() {
  console.log('--- Starting Concurrency Test ---');

  // 1. Reset Database State
  await prisma.transaction.deleteMany({});
  await prisma.user.deleteMany({});

  const alice = await prisma.user.create({
    data: { name: 'Alice', balance: 500 } // 5 BDT
  });

  const bob = await prisma.user.create({
    data: { name: 'Bob', balance: 0 }
  });

  console.log(`Initial Balances - Alice: ${alice.balance}, Bob: ${bob.balance}`);
  console.log('Alice will attempt to send 500 (5 BDT) to Bob 5 times simultaneously.');
  console.log('Due to pessimistic locking, only 1 should succeed, and 4 should fail with "Insufficient funds".');

  // 2. Fire 5 concurrent requests
  const promises = [];
  for (let i = 0; i < 5; i++) {
    // Note: In a real test, we use unique idempotency keys per *attempt* to test concurrency, 
    // not to test the idempotency filter itself. We want all 5 requests to hit the DB lock.
    const uniqueKey = `test-lock-req-${i}`;
    
    promises.push(
      fetch(`${API_URL}/transfer`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': uniqueKey
        },
        body: JSON.stringify({
          senderId: alice.id,
          receiverId: bob.id,
          amount: 500
        })
      }).then(res => res.json())
    );
  }

  const results = await Promise.all(promises);
  console.log('\\nResults of concurrent requests:');
  let successCount = 0;
  let failCount = 0;

  results.forEach((r, index) => {
    if (r.success) {
      successCount++;
      console.log(`Request ${index + 1}: SUCCESS (Tx ID: ${r.transactionId})`);
    } else {
      failCount++;
      console.log(`Request ${index + 1}: FAILED (${r.error})`);
    }
  });

  // 3. Verify Final Balances
  const finalAlice = await prisma.user.findUnique({ where: { id: alice.id } });
  const finalBob = await prisma.user.findUnique({ where: { id: bob.id } });

  console.log('\\n--- Final State ---');
  console.log(`Alice Balance: ${finalAlice?.balance}`);
  console.log(`Bob Balance: ${finalBob?.balance}`);

  if (successCount === 1 && failCount === 4 && finalAlice?.balance === 0 && finalBob?.balance === 500) {
    console.log('\\n✅ TEST PASSED: Pessimistic locking successfully prevented double-spending.');
  } else {
    console.log('\\n❌ TEST FAILED: Race condition occurred or logic is incorrect.');
  }

  process.exit(0);
}

runTest().catch(console.error);
