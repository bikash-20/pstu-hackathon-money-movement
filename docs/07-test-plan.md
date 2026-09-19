# 07 - Test Plan

## In Scope: Concurrency & Reliability
The core value of this application is transaction correctness. I will test:

### 1. Concurrency (Race Conditions) on `/api/transfer`
Simulate multiple simultaneous requests to send money from the same account. Verify that pessimistic locking (`SELECT ... FOR UPDATE`) prevents double-spending and the final balance is strictly correct.

Implemented in `backend/test-concurrency.ts`. The script:
1. Resets the database to a known state (Alice at 500 cents, Bob at 0)
2. Fires 5 concurrent `POST /api/transfer` requests, each with a unique idempotency key, attempting to send 500 cents
3. Asserts exactly 1 succeeds and 4 fail with `"Insufficient funds"`
4. Asserts Alice's final balance is `0` and Bob's final balance is `500`

**Run locally:**
```bash
cd backend
npx ts-node test-concurrency.ts
```

### 2. Idempotency on `/api/transfer` and `/api/request/:id/pay`
Send the exact same transfer/pay request twice with the same `Idempotency-Key`. Verify that only one `Transaction` row is recorded and the second request returns the cached success response.

### 3. Atomic Rollback
Simulate a failure during a transaction (e.g., deducting money succeeds but crediting fails). Verify that the entire database transaction rolls back and the sender's balance is restored.

### 4. Insufficient Funds
Attempt to send more money than the balance allows. Verify the transaction is rejected.

### 5. Split Bill Atomicity
Verify that `/api/split` is genuinely atomic — either every recipient gets credited and one `Transaction` row is written per recipient, or the entire split rolls back leaving every balance unchanged.

Specifically:
- **Happy path:** Alice (৳100,000) splits ৳1,500 across Bob and Charlie. Verify Alice's balance drops by ৳1,500, Bob gets ৳750, Charlie gets ৳750, and exactly 2 `Transaction` rows exist with senderId=Alice.
- **Insufficient funds:** Alice (৳100,000) splits ৳100,001 across Bob and Charlie. Verify every balance is unchanged, no `Transaction` rows are written, and the API returns `"Insufficient funds for full split"`.
- **Unknown recipient:** Split includes a recipient ID that doesn't exist. Verify every balance is unchanged and no `Transaction` rows are written.
- **Remainder rule:** Split an uneven amount (e.g., ৳1,000 across 3 recipients = 333/333/334). Verify the first recipient in the list gets the extra cent and the per-leg sum matches the initiator's debit exactly.
- **Idempotent replay:** Send the same split twice with the same `Idempotency-Key`. Verify the second call returns the cached result and the database state is unchanged (still only N leg rows, not 2N).

### 6. Concurrency on `/api/split`
A concurrency test for Split Bill would extend `test-concurrency.ts` by having Alice attempt to split her full balance across multiple recipients while simultaneously attempting a normal transfer of the same funds to Bob. Exactly one of the two operations should succeed. (This test is recommended for the future; the current build relies on the per-recipient lock and the upfront initiator lock to make this safe.)

## Deliberately Out of Scope
1. **Authentication:** I am using mock users for the demo.
2. **UI/UX Testing:** The frontend is manually verified. Automated tests focus exclusively on the backend API and database integrity.
3. **Pagination / Filter / Search on Transaction History:** Out of scope for this hackathon; the history returns all rows for the user.
4. **Performance / Load Tests:** The pessimistic-lock test covers correctness under concurrency, but I do not run benchmarks for throughput, p99 latency, or connection-pool exhaustion.

---

## v2 Additions — `test-v2-features.ts` (105 assertions)

The v2 build added security and everyday-wallet features, each pinned by an
assertion. Run with `npm run test:v2` (⚠️ resets the database).

| # | Area | What is pinned |
|---|---|---|
| 1 | Zod validation & error envelope | self-transfer, negative/ fractional amounts and a missing `Idempotency-Key` all return 400 with `{ success: false, error }` |
| 2 | Per-transfer cap & daily circuit-breaker | ৳50,000.01 rejected, ৳50,000.00 accepted; four tranches accumulate `dailySpent` to exactly ৳200,000, the fifth is refused *despite sufficient balance*, and a stale `dailyWindow` resets the tally (regression for the timezone bug in Decision 6) |
| 3 | Memo & category | trimmed memo + category persisted; unknown category and >140-char memo rejected; history filters by category and full-text-searches memos |
| 4 | Money-request lifecycle | third party cannot reject; payer can reject (`REJECTED`); rejected request cannot be paid; backdated request cannot be paid, is lazily flipped to `EXPIRED` on read, and no balance moves |
| 5 | Scheduled transfers | past `executeAt` rejected; funds do **not** move before due time; settle skips not-yet-due rows, then debits/credits exactly once and flips the row to `COMPLETED` |
| 6 | QR pay-codes | invalid issue payloads rejected; issuance audited; self-redeem and malformed codes rejected; redeem moves money once; replaying the *same* `Idempotency-Key` returns the original transaction and no second debit; a fresh key against the same code is a legitimate new payment |
| 7 | Contacts, goals, insights, notifications | duplicate/self contact rejected; goal deposits debit the balance, write a `SAVINGS` ledger row, complete at target, notify, then refuse further deposits; insights aggregate categories with percentages summing to ~100; `read-all` clears the unread badge |
| 8 | Pagination & rate limiting | page size + cursor produce disjoint, newest-first pages; limit clamped to 100; `direction=in` returns only credits; 40 rapid writes produce 429s while normal traffic still passes, with a `success:false` body |
| 9 | Security headers | `helmet` sets `nosniff` + frame options, hides `x-powered-by`, and rate-limit headers are exposed |
| 10 | Audit trail & admin guard | `ADMIN_RESET` is recorded; reset reseeds the three balances and clears the ledger; when `ADMIN_SECRET` is set, the reset endpoint 403s without the header |

**Frontend manual checks** live in [`09-feature-test-checklist.md`](./09-feature-test-checklist.md).
