# 08 - Demo Plan

## Pre-Demo Checklist
- [ ] Run `curl -X POST https://pstu-hackathon-backend.onrender.com/api/admin/reset` to wipe and re-seed the production database.
- [ ] Ping the Render backend URL 5 minutes before the demo to avoid a cold start (cold start after 15 minutes of inactivity — see `09-judge-qa.md` Q3).
- [ ] Open the Vercel frontend URL in the presenting browser.
- [ ] Open a second tab on the frontend as a second user (use a private/incognito window so the "Simulating As" dropdowns don't share session storage) to demonstrate the request-money and split-bill flows between two users.
- [ ] Open the `backend/test-concurrency.ts` script ready to run, or have it running in a terminal so the concurrent-transfer demo is visible.
- [ ] Have a database viewer (DBeaver, `psql`, or the Prisma Studio `npx prisma studio` against the Render external URL) connected to the Render PostgreSQL instance, ready to query `SELECT * FROM "Transaction" ORDER BY "id" DESC LIMIT 10;` if a judge wants to inspect the audit ledger.

---

## Script & Timing (5 Minutes Total)

### 1. Introduction (30s)
- "I built a reliable Money Movement Application. The core challenge in fintech isn't just moving money — it's preventing double-spending and handling network failures."
- Show the UI. Point out the "Simulating As" dropdown at the top right and explain that the auth flow was deliberately simulated to keep the build focused on transaction correctness.
- Mention briefly that this is a closed ecosystem on Render free tier — backend, database, and frontend are all on free hosting, no paid credits.

### 2. Basic Transfer (45s)
- Simulate as Alice. Show her balance (৳100,000).
- Send ৳500 to Bob. Show the success banner and the updated balance.
- **Under the hood:** Briefly mention that this was wrapped in an ACID database transaction with a pessimistic row lock and a unique idempotency key.

### 3. The 'Double Click' Problem (60s)
- Explain the race condition: "What if a user clicks Send 5 times very fast?"
- Switch to the terminal and run the concurrency test:
  ```bash
  cd backend && npx ts-node test-concurrency.ts
  ```
- Point at the output as the 5 concurrent requests resolve: "Watch — 1 succeeds, 4 fail with 'Insufficient funds'. Alice's balance went from 500 cents to 0 cents exactly, never negative."
- Switch to the database viewer and run:
  ```sql
  SELECT * FROM "Transaction" ORDER BY "id" DESC LIMIT 5;
  ```
  Show that exactly 1 row was inserted. "Without the lock, all 5 would have read 500 cents, all 5 would have passed the balance check, and Alice would have spent ৳25,000 she didn't have."

### 4. The 'Network Drop' Problem (45s)
- Explain the retry issue: "What if the network drops and the app retries the transfer?"
- Explain the solution: "Every request sends a unique UUID in the `Idempotency-Key` header. The backend caches the result by that key. A retry returns the cached success instead of moving the money twice."
- Show the relevant code on the screen — backend's idempotency lookup, and the frontend's `crypto.randomUUID()` call.

### 5. Request Money + Transaction History (45s)
- Open a second tab as Alice. Request ৳1,200 from Bob.
- Switch to Bob's tab. The pending request appears in the right-hand panel with a Pay button. Pay it.
- Switch back to Alice's tab. Scroll down to "Recent Activity." Show that Alice now sees `Received from Bob ৳1,200.00` with a timestamp.
- "Every settled request writes one Transaction row, so the audit ledger and the user history are always consistent."

### 6. Split Bill for Real-World Context (45s)
- Stay on Alice's tab. Open the Split Bill section.
- Toggle Bob and Charlie as recipients. Enter total `৳1,500`.
- The preview shows `৳750.00 each`.
- Click **Split Payment**.
- Show Alice's balance dropped by ৳1,500 and the Recent Activity now lists two `Sent to` rows (৳750 each).
- "This is one atomic operation — if the initiator ran out of funds mid-split, or any recipient didn't exist, the whole split rolls back. No partial transfers. The same pessimistic-lock and idempotency pattern as a single transfer, extended across N recipients."

### 7. Wrap-up (30s)
- "By focusing on database locks, idempotency, and atomic operations, I built a system that is genuinely trustworthy — even under concurrent retries, network failures, or multi-step group payments."
- "The whole stack runs on free-tier hosting: Render for the backend and database, Vercel for the frontend. No paid credits needed."

---

## If a Judge Asks for a Live Stress Test
If a judge wants to see concurrency live in the browser rather than via the terminal script:
1. Open the frontend as Alice.
2. Click "Send Instantly" rapidly 5-10 times before the first response resolves.
3. Show that Alice's balance never goes negative and the transaction history only contains the successes.
4. The pessimistic lock guarantees serialization; the unique idempotency key guarantees no duplicates.

---

## Recovery Plan If Something Goes Wrong During the Demo
- **Backend down / cold start:** Ping it manually, wait 10-20 seconds, refresh.
- **Frontend shows no users:** The DB was probably reset but not re-seeded. Run `curl -X POST https://pstu-hackathon-backend.onrender.com/api/seed` from the terminal, then refresh the page.
- **Demo state is corrupted / partial state visible:** Run `curl -X POST https://pstu-hackathon-backend.onrender.com/api/admin/reset` and refresh the page. This wipes everything and re-seeds Alice, Bob, Charlie at ৳100,000 each in one shot.
