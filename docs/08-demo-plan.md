# 08 - Demo Plan

### Pre-Demo Checklist
- [ ] Ping the Render backend URL 5 minutes before the demo to avoid a cold start.
- [ ] Open the Vercel frontend URL.
- [ ] Open a database viewer (e.g., DBeaver or psql) connected to the Render PostgreSQL instance.

### Script & Timing (3-5 Minutes)

**1. Introduction (30s)**
- "I built a reliable Money Movement Application. The core challenge in fintech isn't just moving money, it's preventing double-spending and handling network failures."
- Show the UI. Point out the mock auth ("Select User") and explain it was a deliberate choice to save time for concurrency engineering.

**2. Basic Transfer (1m)**
- Log in as Alice. Show her balance (100,000 BDT).
- Send 500 BDT to Bob.
- Show the success state and updated balance.
- **Under the hood:** Briefly mention that this was wrapped in an ACID database transaction.

**3. The 'Double Click' Problem (1m)**
- Explain the race condition: "What if a user clicks Send 5 times very fast?"
- *If I built a visual demo for this, click a button rapidly.*
- Switch to the database view or explain the code: "I used PostgreSQL and `SELECT ... FOR UPDATE`. This applies a pessimistic row-level lock. Only one transaction can touch Alice's balance at a time. The others wait, and fail if she runs out of money."

**4. The 'Network Drop' Problem (1m)**
- Explain the retry issue: "What if the network drops and the app retries the transfer?"
- Explain the solution: "Every request sends a unique UUID (Idempotency Key). The backend caches the result. A retry won't double-charge."

**5. Wrap-up (30s)**
- "By focusing on database locks and idempotency, I built a system that is genuinely trustworthy, even at scale."
