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
