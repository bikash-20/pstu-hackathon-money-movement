# PSTU IT Carnival 2026 — Money Movement Application
<img width="1156" height="722" alt="image" src="https://github.com/user-attachments/assets/e1e6b992-405e-4296-a996-0a156b6b15e7" />

<img width="1156" height="722" alt="image" src="https://github.com/user-attachments/assets/a2bf23b3-38fe-4dba-bd68-4cac9855ded6" />


A reliable, highly-concurrent digital wallet demonstrating fintech-grade transaction
safety (pessimistic locking, idempotency, atomic group payments) on a closed
ecosystem — hardened with rate limiting, schema validation, spend limits, and an
append-only audit trail.

## Live URLs
*   **Frontend (Vercel):** https://frontend-alpha-inky-87.vercel.app
*   **Backend API (Render):** https://pstu-hackathon-backend.onrender.com

## Architecture Highlights
*   **PostgreSQL** for strict ACID compliance and row-level locking (`SELECT ... FOR UPDATE`) to prevent double-spending race conditions.
*   **Idempotency Keys** to prevent duplicate transactions during network failures or retries. The `Transaction.idempotencyKey` column has a `UNIQUE` constraint at the database level, so dedup is enforced even if the application logic fails.
*   **Integer/Cents** math to avoid floating-point precision errors.
*   **Atomic Split Bill** — one database transaction wraps the initiator debit and every recipient credit. If any leg fails, the entire split rolls back; nothing partially transfers.
*   **Rate limiting** — 30 money writes/minute per client IP + user id, 120 requests/minute overall (`express-rate-limit`).
*   **Schema validation** — every write route is validated with `zod`; failures return a consistent `{ success: false, error }` envelope.
*   **Security headers** — `helmet` on every response, `x-powered-by` hidden.
*   **Spend ceilings** — ৳50,000 per transfer, ৳200,000 per settlement day (Asia/Dhaka day key on the user row, so rollover is exact, not timestamp arithmetic).
*   **Append-only audit trail** — `AuditLog` records admin resets and QR issuance; `Transaction` remains the immutable money ledger.

## Features (v2)
Everyday money primitives, plus the free features real wallets ship without any
paid vendor:

| Feature | Endpoint |
|---|---|
| Send money with memo + category | `POST /api/transfer` |
| Request money, pay, **reject**, auto-expiry (7 days) | `POST /api/request`, `/api/request/:id/pay`, `/api/request/:id/reject` |
| Split bill (atomic, remainder rule) | `POST /api/split` |
| **Scheduled transfers** (outbox pattern, settle via worker/demo button) | `POST /api/scheduled`, `/api/scheduled/settle` |
| **QR pay-codes** (`pstuqr.<receiver>.<amount>.<nonce>`) | `POST /api/qr/issue`, `/api/qr/redeem` |
| **Saved payees** | `GET/POST/DELETE /api/contacts` |
| **Savings goals** (earmarked balance, ledgered deposits) | `GET/POST /api/goals`, `POST /api/goals/:id/deposit` |
| **Spending insights** (category breakdown) | `GET /api/insights/:userId?days=30` |
| **Notifications** + unread badge + read-all | `GET /api/notifications/:userId` |
| **Paginated history** with direction/category/memo search | `GET /api/transactions/:userId?limit&cursor&direction&category&q` |
| Demo seed / reset (optionally secret-guarded) | `POST /api/seed`, `POST /api/admin/reset` |

## Project Structure
```
backend/
  src/config.ts            ports, caps, limits, CORS, business timezone
  src/validate.ts          zod schemas for every write route
  src/middleware.ts        rate limiters, idempotency + admin guards, fail()
  src/money.ts             FOR UPDATE locks, daily-window limits, notifications
  src/routes/*.ts          one module per resource (transfer, split, qr, …)
  test-concurrency.ts      30 assertions: locks, split atomicity, replay
  test-v2-features.ts      105 assertions: limits, expiry, QR, goals, …
frontend/
  src/app/page.tsx         wallet shell + money forms
  src/app/components/      goals, QR, schedule, insights, history, inbox panels
  src/app/types.ts         shared domain types
  src/app/lib.ts           API client, currency + idempotency helpers
docs/                      PRD, API spec, decisions log, demo + test plans
```

## Local Setup

### Prerequisites
*   Node.js (v20+)
*   PostgreSQL (or use the provided `docker-compose.yml`)

### Backend
```bash
cd backend
cp .env.example .env         # then set DATABASE_URL
npm install                  # runs `prisma generate`
npx prisma migrate deploy    # apply the schema
npm run dev                  # boots on :4000 (tsx watch)
```

To seed the demo users (Alice, Bob, Charlie at ৳100,000 each):
```bash
curl -X POST http://localhost:4000/api/seed
```

To run the tests (⚠️ both suites reset the database — never point them at production):
```bash
npm run test         # concurrency + split-bill invariants (30 assertions)
npm run test:v2      # v2 features + security (105 assertions)
npm run typecheck    # tsc --noEmit (includes both suites)
```

### Frontend
```bash
cd frontend
npm install
npm run dev
```

Set `NEXT_PUBLIC_API_URL` in `.env.local` to your backend URL (with or without trailing `/api` — the frontend normalizes it).

## Environment variables (backend)

| Variable | Default | Purpose |
|---|---|---|
| `DATABASE_URL` | — | Postgres connection string |
| `PORT` | `4000` | HTTP port |
| `CORS_ORIGINS` | `*` | Comma-separated allow-list (`https://app.vercel.app,…`) |
| `ADMIN_SECRET` | _(open)_ | When set, `POST /api/admin/reset` requires `x-admin-secret` |
| `MAX_TRANSFER_CENTS` | `5000000` | Per-transfer cap (৳50,000) |
| `DAILY_LIMIT_CENTS` | `20000000` | Daily spend ceiling per user (৳200,000) |
| `WALLET_TIMEZONE` | `Asia/Dhaka` | Settlement day used by the daily ceiling |
