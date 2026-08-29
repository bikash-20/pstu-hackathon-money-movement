# 06 - Engineering Decisions Log

This document tracks key engineering decisions made during the hackathon and the reasoning behind them.

### Decision 1: Simplified Authentication
**Date:** 2026-08-29
**Decision:** We are using a "Select a User" dropdown instead of a full JWT/Session signup/login flow.
**Reasoning:** The hackathon is 6 hours long. The problem statement emphasizes transaction correctness, reliability, and concurrency, not auth boilerplate. Time saved by skipping a login screen is invested in pessimistic locking and idempotency logic.

### Decision 2: Render PostgreSQL over SQLite
**Date:** 2026-08-29
**Decision:** We are using a hosted PostgreSQL database on Render instead of a local SQLite file.
**Reasoning:** To demonstrate real-world fintech reliability, we must handle race conditions (e.g., rapid double-clicking "Send"). SQLite locks the entire database on writes, masking these issues. PostgreSQL allows row-level locking (`SELECT ... FOR UPDATE`), letting us prove our concurrency strategy works.

### Decision 3: Integer/Cents for Currency
**Date:** 2026-08-29
**Decision:** All monetary values are stored and calculated as integers (cents).
**Reasoning:** Floating-point math introduces precision errors (e.g., `0.1 + 0.2 = 0.30000000000000004`). Integers guarantee exact arithmetic for financial transactions.

### Decision 4: Robust API URL Construction on Frontend
**Date:** 2026-08-29
**Decision:** We actively normalize `NEXT_PUBLIC_API_URL` on the frontend to ensure it always correctly ends in `/api`.
**Reasoning:** When deploying, configuring the base URL as `https://pstu-hackathon-backend.onrender.com` caused API calls to incorrectly route to `/users` (returning 404s) instead of `/api/users`. By normalizing the environment variable directly within the app code, we remove the brittleness of expecting a specific trailing path structure from external environment variable configuration.
### Decision 5: Production Seed Strategy (POST /api/seed + /api/admin/reset)
**Date:** 2026-08-29
**Decision:** I seed the production database by hitting a dedicated `POST /api/seed` endpoint on the deployed backend, and reset it between demo runs by hitting `POST /api/admin/reset`. I am not wiring a `prisma db seed` script into the build pipeline.
**Reasoning:** Render's free-tier web service does not expose a shell or SSH, so I cannot run `npx prisma db seed` against the production database after a deploy. Adding the seed step to the build command would run it on every redeploy — non-idempotent inserts would either fail on the unique constraint or duplicate data, neither of which I can tolerate in a closed money ecosystem. The `POST /api/seed` endpoint is guarded by a `prisma.user.count() === 0` check, so it only inserts the three seed users (Alice, Bob, Charlie at 100,000 BDT each) on the very first call when the table is empty, and is a no-op on every subsequent call. For demo recovery I also exposed `POST /api/admin/reset`, which wipes `Transaction`, `MoneyRequest`, and `User` rows in foreign-key-safe order, then re-seeds the three users. The reset is a single-source-of-truth recovery path: there is no real data to preserve in this hackathon's closed ecosystem, and the audit ledger must always match the user balances, so a clean wipe is both faster and more correct than any attempt to reconcile partial state by hand.