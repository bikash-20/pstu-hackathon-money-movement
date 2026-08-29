# 05 - Database Architecture

## Technology Choice: PostgreSQL
I am using **PostgreSQL** (hosted on Render's free tier).
**Why not SQLite?** While SQLite is easier to set up, it locks the entire database on writes. To demonstrate real-world fintech concurrency (like pessimistic row-level locking via `SELECT ... FOR UPDATE`), PostgreSQL is required. Render's free PostgreSQL tier provides a genuine cloud-native environment suitable for this.

## Schema Strategy: Simple Balance + Audit Log
**Why this approach over Full Double-Entry?**
A full double-entry ledger (where balance is strictly a `SUM(credits) - SUM(debits)`) is the gold standard but requires more complex querying and indexing for a 6-hour hackathon. 
Instead, I maintain a `balance` column on the `users` table and an immutable `transactions` table. This allows me to demonstrate ACID properties: wrapping the deduction, the addition, and the log insertion in a single atomic database transaction.

## Tables
1. **`User`**: `id`, `name`, `balance` (Integer, cents to avoid float precision issues)
2. **`Transaction`**: `id`, `senderId`, `receiverId`, `amount`, `status`, `idempotencyKey`
3. **`MoneyRequest`**: `id`, `requesterId`, `payerId`, `amount`, `status`
