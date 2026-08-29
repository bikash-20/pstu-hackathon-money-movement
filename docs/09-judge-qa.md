# 09 - Judge Q&A / Anticipated Questions

### 1. Why didn't you build a real login system?
**Answer:** In a 6-hour hackathon, I had to prioritize what matters most to the prompt: transaction reliability. A full JWT auth flow takes time away from building robust concurrency handling (like pessimistic locking and idempotency). I chose to simulate auth so I could focus on the hard engineering problems of moving money safely.

### 2. Why are you using PostgreSQL instead of a simpler DB like SQLite?
**Answer:** To prove my system handles race conditions safely. SQLite locks the entire database on writes, which makes it hard to demonstrate real concurrent transactions. PostgreSQL supports row-level locking (`SELECT ... FOR UPDATE`), which allows me to simulate a real-world high-concurrency fintech environment.

### 3. I noticed the backend took a few seconds to respond on the very first request. Why?
**Answer:** **(Cold Start Risk)** I deployed the backend to Render's free tier to ensure the entire stack runs without paid credits. Render spins down free web services after 15 minutes of inactivity. The initial delay is the container spinning back up. Once awake, transactions are processed in milliseconds. *(Note: I will ping the service before the demo to avoid this live — see `08-demo-plan.md`.)*

### 4. What happens if the network drops right after I click 'Send'?
**Answer:** I implemented **Idempotency Keys**. The frontend generates a unique UUID for every transfer, request-pay, and split attempt. If the network drops and the frontend retries the request, the backend recognizes the duplicate key and returns the cached success response instead of moving the money twice. The `Transaction.idempotencyKey` column has a `UNIQUE` constraint at the database level, so the dedup is enforced even if the application logic fails.

### 5. Why is there a Split Bill feature? Why not just do three separate transfers?
**Answer:** Three separate transfers would be three independent atomic operations, and the user-visible result would be similar — but there are two correctness problems with that approach. First, the three transfers are not atomic *together*: if the second transfer fails (e.g., the recipient runs out of funds between transfers), the user has paid one person but not the others, and the partial state is hard to undo cleanly. Second, the three transfers are not idempotent *together*: if the network drops after the first one, the retry would re-send just that one, and the user might double-charge someone. By wrapping the entire split in one database transaction with one idempotency key (and per-leg keys derived deterministically from it), I get true atomicity and one-shot replay safety.

### 6. What happens if the initiator runs out of funds mid-split?
**Answer:** That cannot happen, by construction. The endpoint acquires a `SELECT ... FOR UPDATE` lock on the initiator's row *before* checking the balance or doing any writes. The lock is held for the entire `prisma.$transaction`, so no concurrent transfer or split can drain the balance out from under us between the check and the debit. If the balance is insufficient, the upfront check throws and the entire transaction rolls back — every recipient's balance is unchanged and no `Transaction` rows are written. This is the same pattern used in single transfers, extended across N recipients in one atomic step.

### 7. What if the cents don't divide evenly? (e.g., ৳1,000 across 3 people)
**Answer:** Each recipient gets `floor(total / N)` cents, and any leftover remainder cents go to the first recipient. So ৳1,000.00 across 3 recipients is ৳333.34, ৳333.33, ৳333.33 — the extra cent goes to recipient #1. This guarantees that `sum(per-recipient credits) === totalAmount` exactly, with no cents lost to rounding. The frontend shows this preview live before the user confirms the split.

### 8. Why isn't the Transaction History paginated? Won't it get huge?
**Answer:** At 10 million users each making ~1 transaction/day, that's ~10 million rows per day. In a real production system this would absolutely need pagination, an indexed `createdAt DESC` query, and probably an archival tier. For this 6-hour closed-ecosystem demo with 3 seeded users, pagination would be over-engineering. I explicitly cut it from scope in `02-PRD.md` and noted it as a "future improvement." The history does order most-recent-first and uses a single indexed query, so the demo remains responsive.

### 9. Why are `/api/admin/reset` and `/api/seed` unprotected? Anyone with the URL could wipe my data.
**Answer:** By design, and explicitly documented as such in `06-decisions.md` (Decision 5). Render's free tier does not expose a shell or SSH, so the only practical way to seed the production database and reset between demo runs is via an HTTP endpoint. Both endpoints are guarded by their own logic (`/api/seed` only inserts when `count === 0`; `/api/admin/reset` always wipes and re-seeds the 3 demo users). The closed demo ecosystem has no real data to protect, and the URL is not published. In a real production system I would put these behind an admin API key or a separate admin-only deployment.

### 10. Did you write tests? How do I know the locking actually works?
**Answer:** Yes — `backend/test-concurrency.ts` resets the database, gives Alice exactly 500 cents, fires 5 concurrent `POST /api/transfer` requests, and asserts that exactly 1 succeeds, 4 fail with "Insufficient funds," and Alice's final balance is exactly 0 (not negative). I will run this live during the demo. The same pattern is recommended for Split Bill in `07-test-plan.md`.

### 11. What is your database schema and why?
**Answer:** Three tables: `User` (with a `balance` column in cents), `Transaction` (immutable audit log of every money movement), and `MoneyRequest` (state machine for request/pay flows). I deliberately did not implement full double-entry bookkeeping — a `SUM(credits) - SUM(debits)` derivation — because for a 6-hour hackathon the per-user `balance` column paired with the immutable `Transaction` table is sufficient to demonstrate ACID properties, while staying simple enough to query and reason about. Full double-entry is the gold standard for real fintech and is noted as a future improvement. See `05-database.md` for the full schema and reasoning.

### 12. What happens if the frontend is calling the wrong path again, like the `/users` vs `/api/users` bug you had earlier?
**Answer:** That bug is fixed at the source. The frontend now normalizes `NEXT_PUBLIC_API_URL` on every call to always end in `/api` — see `06-decisions.md` Decision 4. Whether the environment variable is configured as `https://...onrender.com` or `https://...onrender.com/api`, every request routes correctly. There is no longer a way to misconfigure it.