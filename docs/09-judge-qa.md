# 09 - Judge Q&A / Anticipated Questions

### 1. Why didn't you build a real login system?
**Answer:** In a 6-hour hackathon, we had to prioritize what matters most to the prompt: transaction reliability. A full JWT auth flow takes time away from building robust concurrency handling (like pessimistic locking and idempotency). We chose to simulate auth so we could focus on the hard engineering problems of moving money safely.

### 2. Why are you using PostgreSQL instead of a simpler DB like SQLite?
**Answer:** To prove our system handles race conditions safely. SQLite locks the entire database on writes, which makes it hard to demonstrate real concurrent transactions. PostgreSQL supports row-level locking (`SELECT ... FOR UPDATE`), which allows us to simulate a real-world high-concurrency fintech environment.

### 3. I noticed the backend took a few seconds to respond on the very first request. Why?
**Answer:** **(Cold Start Risk)** We deployed the backend to Render's free tier to ensure the entire stack runs without paid credits. Render spins down free web services after 15 minutes of inactivity. The initial delay is the container spinning back up. Once awake, transactions are processed in milliseconds. *(Note: The team will ping the service before the demo to avoid this live).*

### 4. What happens if the network drops right after I click 'Send'?
**Answer:** We implemented **Idempotency Keys**. The frontend generates a unique UUID for every transfer attempt. If the network drops and the frontend retries the request, the backend recognizes the duplicate key and returns the cached success response instead of moving the money twice.
