# 02 - Product Requirements Document (PRD)

## MVP Scope
The application is a closed-ecosystem digital wallet focused on core money-movement primitives, plus two real-world features that are particularly relevant for a Bangladeshi student context:

1. **User Accounts:** Users are pre-provisioned (via `POST /api/seed`) or auto-registered with ৳100,000 simulated balance (10,000,000 cents). The frontend exposes a "Simulating As" dropdown in place of a full login flow.
2. **Send Money (P2P Transfer):** Users can send funds to other registered users. Must be immediate and atomic. Uses `SELECT ... FOR UPDATE` row locks and a unique `Idempotency-Key` constraint to prevent double-spending and double-charge.
3. **Request Money:** Users can request funds from another user. The requested user can "Pay" the request, which debits their balance, credits the requester, marks the request `PAID`, and writes one `Transaction` row so it shows up in the history.
4. **Transaction History:** Immutable ledger of all movements in and out of the user's account, most recent first. Includes settled money requests and split-bill legs so the user sees a complete audit trail.
5. **Split Bill (Atomic Group Payment):** A user can split a total amount evenly across one or more recipients in a single atomic operation. Either every recipient gets credited (and one `Transaction` row is logged per recipient) or the entire split rolls back. Cents that do not divide evenly are absorbed by the first recipient so the per-leg sum matches the initiator's debit exactly.

## Cut Line (Deliberately Out of Scope)
Given the 6-hour hackathon constraint, the following are cut:
1. **Full Authentication (JWT/Sessions/Passwords):** Replaced with a "Simulating As" dropdown to demonstrate functionality quickly without boilerplate. Time saved goes into concurrency engineering.
2. **Real Banking Integration / Payment Gateways:** Funds are simulated; the system is a closed ecosystem.
3. **Double-Entry Bookkeeping:** A full double-entry ledger is the gold standard but requires more complex querying and indexing than a 6-hour build allows. A simple `balance` column paired with an immutable `Transaction` table is sufficient to demonstrate transactional integrity within the time limit, while still wrapping every deduction, credit, and log insertion in a single atomic DB transaction.
4. **Complex UI/UX:** The focus is on backend correctness and concurrency safety. The UI is functional, clean, but minimal.
5. **Request Rejection Flow:** The schema supports a `REJECTED` status for `MoneyRequest` but the API and UI do not yet expose rejection — noted as a "future improvement" in `06-decisions.md`.
6. **Pagination / Filtering / Search on Transaction History:** Out of scope; the history returns all rows for the user, ordered most recent first. Sufficient for a closed demo.
7. **Custom Split Ratios:** Split Bill is even-split only. Custom shares (e.g., "I owe more, you owe less") are out of scope.