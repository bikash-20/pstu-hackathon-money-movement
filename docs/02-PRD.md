# 02 - Product Requirements Document (PRD)

## MVP Scope
The application is a closed-ecosystem digital wallet focused on core money movement primitives:
1. **User Accounts:** Users are pre-provisioned or auto-registered with 100,000 BDT simulated balance.
2. **Send Money (P2P Transfer):** Users can send funds to other registered users. Must be immediate and atomic.
3. **Request Money:** Users can request funds from others. The requested user can "Pay" or "Reject".
4. **Transaction History:** Immutable ledger of all movements in and out of the user's account.

## Cut Line (Deliberately Out of Scope)
Given the 6-hour hackathon constraint, the following are cut:
1. **Full Authentication (JWT/Sessions/Passwords):** Replaced with a "Select User to Simulate" dropdown to demonstrate functionality quickly without boilerplate.
2. **Real Banking Integration / Payment Gateways:** Funds are simulated.
3. **Double-Entry Bookkeeping:** While standard for enterprise fintech, a simple balance column paired with an immutable transactions table is sufficient to demonstrate transactional integrity within the time limit.
4. **Complex UI/UX:** The focus is on the backend correctness and concurrency safety. The UI will be functional, clean, but minimal.
