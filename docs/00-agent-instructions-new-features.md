# 00-agent-instructions-new-features.md

I have ~3 hours left. I want to add two real-world features that make sense specifically for a Bangladeshi student/user context, and that also reinforce the "we thought about correctness" story for judges. Implement both, but do not commit/push or redeploy until I explicitly say go — I want to review locally first.

## Feature 1: Transaction History

**Why:** Any real wallet needs to show past activity — for tracking expenses, reconciling at month-end, and general trust/auditability.

**What to build:**

- **Backend:** `GET /api/transactions/:userId` — returns all transactions where the user is either sender or receiver, most recent first. Use the existing transactions table (should already have `sender_id`, `receiver_id`, `amount`, `status`, `created_at` from the original schema — confirm and adjust if it's missing anything needed here).
- **Frontend:** A "Recent Activity" or "Transaction History" section on the dashboard — a simple list showing, for each transaction: direction (sent/received), counterparty name, amount, date/time, and status. Reuse existing styling/components where possible, don't over-engineer the UI.
- Include both completed transfers AND settled money requests (i.e., a paid request should also show up here as a transaction) — check whether paying a request already creates a transactions row; if not, make sure it does, since this is also relevant to the audit-trail story in the docs.

## Feature 2: Split Bill / Group Payment

**Why:** Splitting mess bills, group tea/snacks, event contributions — a very common real scenario for students specifically. It's also a good demonstration of multi-step atomic transaction handling, which ties directly into the concurrency/reliability story already built for this project.

**What to build:**

- A new flow: one user selects multiple recipients + a total amount (or splits it evenly, or lets them enter custom shares — keep it simple, evenly-split is fine for the MVP) and triggers a single "split payment."
- **Backend:** this must be one atomic operation — either all the individual transfers succeed, or none of them do (full rollback on any failure, e.g. if the initiator doesn't have enough balance to cover the full split amount). Do NOT process each recipient as a separate independent request; wrap the whole thing in one DB transaction, same pattern as the existing single transfer logic (reuse the pessimistic locking approach already in place for transfers).
- **Frontend:** a simple form — "Split Bill" section, pick multiple recipients (checkboxes or multi-select from existing users), enter total amount, shows the per-person split amount, one submit button.
- Make sure this reuses the existing Idempotency-Key pattern from the single-transfer endpoint, since it's the same category of risk (accidental double-submit).

## Constraints

- Keep both features scoped tight — this is still a hackathon MVP, not a feature-complete product. Don't add extra polish (filters, pagination, search, custom split ratios, etc.) unless it's genuinely trivial — if in doubt, skip it and note it as a "future improvement" instead.
- Don't touch or refactor the existing send/request/pay/reset code beyond what's strictly needed to reuse the locking pattern for split payments.
- Do not push or deploy anything. Work locally, test locally, then stop and report back.

## When done — report back, don't push

Tell me:

1. What you built for each feature, briefly.
2. How you tested each locally (especially: did you verify the split payment is genuinely atomic — e.g. test a split where the initiator doesn't have enough balance, confirm nothing partially transfers).
3. Any schema changes you had to make (new columns, new tables) — call these out clearly since they affect `05-database.md`.
4. Anything you skipped or simplified that I should know about.

I'll review, then tell you to commit, push, and redeploy.
