# PSTU IT Carnival 2026 - Money Movement Application

A reliable, highly-concurrent digital wallet application demonstrating fintech-grade transaction safety (pessimistic locking, idempotency, and atomic group payments) on a closed ecosystem.

## Live URLs
*   **Frontend (Vercel):** https://frontend-alpha-inky-87.vercel.app
*   **Backend API (Render):** https://pstu-hackathon-backend.onrender.com

## Architecture Highlights
*   **PostgreSQL** for strict ACID compliance and row-level locking (`SELECT ... FOR UPDATE`) to prevent double-spending race conditions.
*   **Idempotency Keys** to prevent duplicate transactions during network failures or retries. The `Transaction.idempotencyKey` column has a `UNIQUE` constraint at the database level, so dedup is enforced even if the application logic fails.
*   **Integer/Cents** math to avoid floating-point precision errors.
*   **Transaction History** — every movement in and out of a user's account, including settled money requests and split-bill legs, in a single immutable audit ledger.
*   **Atomic Split Bill** — one database transaction wraps the initiator debit and every recipient credit. If any leg fails (insufficient funds, unknown recipient, race collision) the entire split rolls back; nothing partially transfers.

## Project Structure
*   `/docs` - Comprehensive engineering documentation, PRD, API specs, decisions log, and judge Q&A.
*   `/backend` - Node.js / Express API (Prisma + PostgreSQL)
*   `/frontend` - Next.js / React Web App (deployed to Vercel)

## Local Setup

### Prerequisites
*   Node.js (v18+)
*   PostgreSQL (or use the provided `docker-compose.yml`)

### Backend
```bash
cd backend
npm install
# Set DATABASE_URL in .env to your local Postgres URL
npx prisma migrate dev
npm run dev
```

To seed the demo users (Alice, Bob, Charlie at ৳100,000 each):
```bash
curl -X POST http://localhost:4000/api/seed
```

To run the concurrency test:
```bash
npx ts-node test-concurrency.ts
```

### Frontend
```bash
cd frontend
npm install
npm run dev
```

Set `NEXT_PUBLIC_API_URL` in `.env.local` to your backend URL (with or without trailing `/api` — the frontend normalizes it).