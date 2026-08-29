I reviewed your implementation plan. Good work on the concurrency section (pessimistic locking, idempotency keys, ACID transaction wrapping, integer/cents for money) — keep all of that exactly as proposed, it's correct and it's the part judges will care about most.
Three corrections before you start building:
1. Auth — use the simplified demo auth, not full JWT
Skip full JWT signup/login. Use the "select a user to simulate" dropdown option you proposed as an alternative. This is a 6-hour hackathon — auth is not what's being judged, transaction correctness is. Time saved here goes into the concurrency/reliability work instead. Still create real users rows with hashed placeholder passwords or none at all — just don't build a full login screen/session/JWT flow.
2. Everything must run on free tier — no exceptions
Every service, tool, and host in this stack must have a genuine free tier that survives a live demo (no trial credits that run out, no "add billing after X"). Confirm this explicitly for each piece of the stack before we lock it in (DB host, backend host, frontend host, any API you call).
3. Deployment — GitHub + Render + Vercel
Lock in this deployment path:
Source control: Push the repo to GitHub (create it if one doesn't exist). Commit as you build, not just at the end — I want commit history that shows the build progression, since judges may check it.
Backend + database: Deploy to Render free tier (web service + free Postgres instance, or SQLite on a persistent disk if that's simpler for a 6-hour build — your call, but state which and why in 05-database.md).
Frontend: Deploy to Vercel free tier.
Confirm both are actually reachable via public URL before we call the build phase done — a build that only runs on localhost does not count as finished. Include both live URLs in the README.
If Render's free tier cold-starts (spins down after inactivity), note that explicitly in 09-judge-qa.md and have a plan (e.g. ping it a few minutes before the demo slot) so it doesn't stall live in front of judges.
4. Documentation — separate files, kept in sync as you build
Create and maintain these as separate markdown files in /docs, not as one long README:
01-problem.md — the problem statement (already provided separately)
02-PRD.md — chosen solution, MVP scope, cut line
03-architecture.md — architecture diagram (ASCII or Mermaid is fine) showing frontend/backend/DB/deployment topology, plus why each piece was chosen
04-api.md — endpoints, request/response shapes
05-database.md — schema + why this schema (e.g. why simple balance column + audit transactions table over full double-entry ledger, why Postgres vs SQLite)
06-decisions.md — running log of engineering decisions and the reasoning behind each, in a format ready to answer "why did you choose this?" from a judge
07-test-plan.md — what's tested (especially the concurrency/race-condition tests) and what's deliberately out of scope
08-demo-plan.md — the live demo script and timing
09-judge-qa.md — anticipated hard questions (including the free-tier cold-start risk above) with honest answers
README.md — setup instructions, live URLs, one-liner
Update the relevant doc(s) in the same turn you make a decision — don't let them drift from the actual code. These docs are what let the team explain and defend every engineering decision live, which the problem statement explicitly requires.
5. Save this prompt
Save this exact prompt (the one you're reading right now) as docs/00-agent-instructions.md in the repo, unedited, as the record of what was actually asked of you. Do this before starting any other work.
