# 05 - Database Architecture

## Technology Choice: PostgreSQL
I am using **PostgreSQL** (hosted on Render's free tier, Singapore region, named `pstu-hackathon-db`).
**Why not SQLite?** While SQLite is easier to set up, it locks the entire database on writes. To demonstrate real-world fintech concurrency (like pessimistic row-level locking via `SELECT ... FOR UPDATE`), PostgreSQL is required. Render's free PostgreSQL tier provides a genuine cloud-native environment suitable for this.

## Schema Strategy: Simple Balance + Audit Log
**Why this approach over Full Double-Entry?**
A full double-entry ledger (where balance is strictly a `SUM(credits) - SUM(debets)`) is the gold standard but requires more complex querying and indexing for a 6-hour hackathon.
Instead, I maintain a `balance` column on the `User` table and an immutable `Transaction` table. This lets me demonstrate ACID properties: wrapping the deduction, the addition, and the log insertion in a single atomic database transaction. Every write to `User.balance` is paired with a `Transaction` row, so the ledger remains the single source of truth and can be reconciled against the balances at any time.

## Tables

### 1. `User`
| Column      | Type     | Notes                                       |
|-------------|----------|---------------------------------------------|
| `id`        | Int (PK) | Auto-increment                              |
| `name`      | String   | Display name                                |
| `balance`   | Int      | In cents; default 10,000,000 (= ৳100,000)   |
| `createdAt` | DateTime | Default `now()`                             |

**Relations:**
- `sentTransactions` — transactions where this user is the sender
- `receivedTransactions` — transactions where this user is the receiver
- `requestsMade` — `MoneyRequest` rows where this user is the requester
- `requestsReceived` — `MoneyRequest` rows where this user is the payer

### 2. `Transaction`
| Column           | Type     | Notes                                                                  |
|------------------|----------|------------------------------------------------------------------------|
| `id`             | Int (PK) | Auto-increment                                                         |
| `senderId`       | Int (FK) | References `User.id`                                                   |
| `receiverId`     | Int (FK) | References `User.id`                                                   |
| `amount`         | Int      | In cents                                                               |
| `status`         | String   | `COMPLETED` or `FAILED`; default `COMPLETED`                           |
| `idempotencyKey` | String   | **Unique** — the deduplication contract for retry safety               |
| `createdAt`      | DateTime | Default `now()`                                                        |

**Why one row per transfer, but potentially N rows per split?** A Split Bill writes one `Transaction` row per recipient leg (each with a derived idempotency key of `<key>:leg:N`). This makes each leg independently queryable in the recipient's history and means a partial rollback cleanly removes every leg.

### 3. `MoneyRequest`
| Column        | Type     | Notes                                                                 |
|---------------|----------|-----------------------------------------------------------------------|
| `id`          | Int (PK) | Auto-increment                                                        |
| `requesterId` | Int (FK) | References `User.id`                                                  |
| `payerId`     | Int (FK) | References `User.id`                                                  |
| `amount`      | Int      | In cents                                                              |
| `status`      | String   | `PENDING`, `PAID`, or `REJECTED`; default `PENDING`                  |
| `createdAt`   | DateTime | Default `now()`                                                       |

**Why a separate `MoneyRequest` table instead of a `status` field on `Transaction`?** A request is *not* a transfer — it is an invitation. Only when the payer actually pays does the request transition to `PAID` and produce a `Transaction` row. Keeping the state machine in its own table makes the lifecycle explicit and avoids confusing "pending transactions" (which would imply money is in flight, when none is).

## Indexes
- `Transaction.idempotencyKey` — UNIQUE. The contract that makes the entire system idempotent under retries. Lookups by key are O(log n).
- All foreign keys — implicit indexes via Prisma.

## Migrations
Migrations are managed by Prisma and live in `backend/prisma/migrations/`. The current state is one migration (`20260829035912_init`) that creates all three tables, the unique index, and the foreign-key constraints. Production is updated by the Render build command: `npm install && npx prisma generate && npx prisma migrate deploy`.