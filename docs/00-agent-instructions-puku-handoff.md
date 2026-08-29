We were working with another AI agent (Gemini-based, "Fintech System Architect") on this project. It had just started fixing a bug — the frontend was calling `/users` instead of `/api/users` on the backend, causing a 404 and an empty user list on the live deployed app. It hit its usage quota mid-fix, error: "Individual quota reached." We don't know what it changed, if anything, before stopping.

You're taking over now. **Before touching any code, do this first:**

## 1. Read the whole project

Go through the entire repository — frontend and backend, all folders, `package.json` files, Prisma schema, routes, and the `/docs` folder. We need you to actually understand the current state of the codebase, not just the one file that was mid-edit. This matters because:

- We don't know exactly what the previous agent already changed (if anything) before quota ran out
- We do NOT want you making assumptions and overwriting or duplicating work
- We do NOT want you "fixing" things that are already fixed, or breaking things that already work

## 2. Read the previous instructions we gave that agent

These are saved in the repo — read them in this order, they tell you the full context of what's been built and what we were mid-fixing:

- `docs/00-agent-instructions.md` (deployment + docs requirements, given earlier in the build)
- `docs/00-agent-instructions-deployment-blocker.md` (the seed-data blocker we hit, and the diagnosis)
- `docs/00-agent-instructions-api-path-bug.md` (the most recent one — the bug the previous agent was fixing when it ran out of quota)

Also skim whatever other docs exist in `/docs` (architecture, database, decisions, etc.) so you understand *why* things were built the way they were, not just *what* was built.

## 3. Report back to us — do not start coding yet

Once you've read everything, tell us:

1. **What you found regarding the `/users` vs `/api/users` bug** — is it already fixed, partially fixed, or untouched? Show us exactly what the current frontend API-calling code looks like right now.
2. **What you understand the overall project to be** — a quick summary in your own words, to prove you actually read it (not required to be long, just needs to show real understanding).
3. **What you plan to do to finish this fix** — the exact change(s) you intend to make, before making them.
4. **Anything that looks off, inconsistent, or risky** that you noticed while reading through — even if unrelated to the immediate bug — flag it, don't silently fix it yet.

Once we review and approve what you're proposing, we'll tell you to proceed. Do not modify, delete, or refactor anything until we say go — we're being careful here because a previous agent stopped mid-change and we don't want the codebase getting messier from two agents stepping on each other's work.

## Save this prompt

Save this exact prompt as `docs/00-agent-instructions-puku-handoff.md` in the repo as a record of the handoff, before doing anything else.