# 07 - Test Plan

## In Scope: Concurrency & Reliability
The core value of this application is transaction correctness. I will test:
1. **Concurrency (Race Conditions):** Simulate multiple simultaneous requests to send money from the same account. Verify that pessimistic locking (`SELECT ... FOR UPDATE`) prevents double-spending and the final balance is strictly correct.
2. **Idempotency:** Send the exact same transfer request twice with the same `Idempotency-Key`. Verify that only one transaction is recorded and the second request returns the cached success response.
3. **Atomic Rollbacks:** Simulate a failure during a transaction (e.g., deducting money succeeds, but crediting fails). Verify that the entire database transaction rolls back and the sender's balance is restored.
4. **Insufficient Funds:** Attempt to send more money than the balance allows. Verify the transaction is rejected.

## Deliberately Out of Scope
1. **Authentication:** I am using mock users for the demo.
2. **UI/UX Testing:** The frontend will be manually verified. Automated tests will focus exclusively on the backend API and database integrity.
