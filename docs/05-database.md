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

## v2 Schema Additions (migration `20260919192331`, `20260920020000`)

**Columns**

| Table | Column | Why |
|---|---|---|
| `User` | `dailySpent Int`, `dailyWindow String` | daily spend circuit-breaker. `dailyWindow` is `"YYYY-MM-DD"` in `WALLET_TIMEZONE` (default Asia/Dhaka); the tally only counts when the key equals today's key, so rollover is exact string equality — no timestamp/timezone arithmetic. See `06-decisions.md` Decision 6. |
| `Transaction` | `memo String?`, `category String @default("TRANSFER")` | free-form note (app-capped at 140 chars) + spending-insights bucket |
| `MoneyRequest` | `note String?`, `expiresAt DateTime` | optional message and 7-day auto-expiry (`EXPIRED` status enforced lazily on read and at pay time) |

**Indexes** — `Transaction @@index([senderId, createdAt])`,
`@@index([receiverId, createdAt])`, `@@index([category])` (history pagination and
insights), `MoneyRequest @@index([payerId, status])` /
`@@index([requesterId, status])` (inbox queries).

**New tables**

| Table | Purpose |
|---|---|
| `Contact` | saved payees, unique per `(ownerId, contactId)`, cascades on owner delete |
| `Goal` | savings jars; `savedAmount`/`targetAmount` in cents, `completedAt` set on completion |
| `Notification` | in-app inbox (`kind`, `title`, `body`, `read`), cascades on user delete |
| `AuditLog` | append-only ops trail (`ADMIN_RESET`, `QR_ISSUE`); `actorId` is `SetNull` so entries survive user deletes |

**Statuses** — `Transaction.status` additionally carries
`SCHEDULED:<iso-datetime>` rows (scheduled-transfer outbox; no money in flight
until settled) and `MoneyRequest.status` carries `EXPIRED`.

## Migrations
Migrations are managed by Prisma and live in `backend/prisma/migrations/`:

1. `20260829035912_init` — three core tables, unique idempotency index, FKs
2. `20260829080000_add_user_phone` — cosmetic mock phone number
3. `20260919192331_fintech_v2_free_features` — v2 tables/columns/indexes above
4. `20260920020000_daily_window_key` — replaces `dailySpentAt` with the `dailyWindow` day key (Decision 6)

Production is updated by the Render build command: `npm install && npx prisma generate && npx prisma migrate deploy`.