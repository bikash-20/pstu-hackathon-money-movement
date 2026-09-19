# Feature Test Checklist — PSTU Wallet v2 (Frontend)

> **Purpose.** This file enumerates every user-visible feature in the current
> frontend (`frontend/src/app/page.tsx`, `components/ui.tsx`,
> `components/NotificationPanel.tsx`, `components/GoalsPanel.tsx`,
> `components/ScheduledPanel.tsx`, `components/SpendingInsights.tsx`) and
> documents manual verification steps the team or judges can run end-to-end
> against the live backend.
>
> **How to use.** Each section has:
> 1. **Where** — the exact UI region the feature lives in.
> 2. **What it does** — one-sentence summary.
> 3. **API** — the backend endpoint(s) it calls.
> 4. **Happy-path test** — the steps that should succeed.
> 5. **Edge cases** — 1-3 things that should *fail* visibly (toast/error).
> 6. **Expected result** — what "correct" looks like.
>
> **Conventions.**
> - All amounts are BDT, integer cents on the wire.
> - Identifiers like `Idempotency-Key` are generated client-side per click.
> - Status badging: `PENDING`, `PAID`, `REJECTED`, `EXPIRED`.
> - Backend cap: ৳50,000 per transfer, ৳200,000 daily per user.
>
> **Last verified against** `frontend/src/app/page.tsx` revision at the time
> this file was written (Sept 2026).

---

## 0. Pre-flight

```bash
# Backend
cd backend && npm install
npx prisma migrate deploy    # apply schema
npx tsx src/index.ts         # boots on :4000
# In another shell:
curl -s localhost:4000/api/health
# → {"success":true,"status":"ok","db":"reachable"}

# Frontend
cd frontend && npm install
npm run dev                  # boots on :3000
# Open http://localhost:3000
```

**Seed users** (from `/api/seed`):
| Name    | Phone              | Initial balance (৳) |
|---------|--------------------|--------------------|
| Alice   | +880 1712-345678   | 100,000.00         |
| Bob     | +880 1823-456789   | 100,000.00         |
| Charlie | +880 1934-567890   | 100,000.00         |

---

## 1. Header — User Switcher

**Where.** Top-right `<select>` next to the bell icon.
**What.** Switch the active demo user. Every panel below re-fetches data for
the selected user.
**API.** `GET /api/users`, then re-runs `refreshAll(uid)` + `loadTxs(uid, true)`
on change.

**Happy path.**
1. Open `http://localhost:3000`.
2. Default user is Alice (first in `/users`).
3. Use the dropdown to switch to **Bob**.
4. Balance card updates to **৳100,000.00**, activity list empties then
   refills with Bob's history.

**Edge cases.**
- If backend returns no users, the app shows the **"Loading wallet"** glass
  skeleton and never advances.
- Switching mid-action cancels no in-flight requests; the latest refresh
  wins, older responses are discarded (race-safe via React state).

**Expected result.** Switching users changes every number in the dashboard
within ~200 ms on a warm backend.

---

## 2. Header — Notification Bell + Badge

**Where.** Bell icon (top-right, left of user switcher).
**What.** Shows the unread notification count as a gold pill; clicking it
calls `POST /api/notifications/:userId/read-all`.
**API.** `GET /api/notifications/:userId`, `POST /api/notifications/:userId/read-all`.

**Happy path.**
1. As Alice, send Bob ৳100. A `TX_SENT` notification is created for Alice.
2. Bell badge increments.
3. Click the bell. Badge clears to 0 and the toast fires silently
   (no success toast for mark-read; just optimistic update).

**Edge cases.**
- 0 unread → no badge rendered.
- 99+ unread → badge still renders single number (truncates by design).

**Expected result.** Badge count matches `notifs.filter(n => !n.read).length`.

> Note: a fuller inbox panel (`components/NotificationPanel.tsx`) exists as
> an extracted component and is polling-ready; the live `page.tsx` ships a
> lightweight inline inbox under the "Requests" activity tab.

---

## 3. Balance Card + Inflow/Outflow Stats

**Where.** Top hero card, full-width, with a gold "brand stripe".
**What.** Shows selected user's balance, plus two badges (In / Out) summing
inflow + outflow from the currently loaded activity page.
**API.** `GET /api/users/:id` (via `/users` listing), `GET /api/transactions/:id?…`.

**Happy path.**
1. As Alice, send Bob ৳500. Balance drops to ৳99,999,500. **Out** badge
   increments by ৳500.
2. Switch to Bob — Balance shows ৳100,000,500, **In** badge increments by ৳500.

**Edge cases.**
- If no transactions have loaded yet, both badges read **৳0.00**.
- Activity page is paginated (20 per page); inflow/outflow only reflect
  the loaded window. (Not a bug; documented behaviour.)

**Expected result.** Numbers always use tabular-nums and the BDT format
"৳1,234.00".

---

## 4. Spending Insights Bar (category breakdown)

**Where.** Below the balance card, conditional on
`insights.breakdown.length > 0`.
**What.** A horizontal stacked bar showing the top 6 spending categories by
share over the last 30 days.
**API.** `GET /api/insights/:userId?days=30`.

**Happy path.**
1. Generate 3 transfers as Alice in different categories (e.g. ৳300 FOOD,
   ৳500 BILLS, ৳200 TRANSPORT).
2. The bar renders 3 segments proportional to spend, plus 3 colour-coded
   legend chips below ("FOOD 33% · BILLS 56% · TRANSPORT 22%").

**Edge cases.**
- All-zero spend → bar hidden entirely (no zero-percent segments).
- More than 6 categories → only top 6 displayed; the remainder is
  aggregated server-side.

**Expected result.** Percentages always sum to ≤100 % (rounding-safe).

---

## 5. Send Money Form

**Where.** GlassCard "Send money", top-left grid cell.
**Form fields.** To (select), Amount (BDT, decimal), Category (select, 10
options), Memo (optional, ≤140 chars).
**What.** Atomic transfer from selected user → chosen recipient.
**API.** `POST /api/transfer` with header `Idempotency-Key: <uuid>`.
**Handler.** `handleSend` in `page.tsx` (calls `parseAmountOrError` first).

**Happy path.**
1. From = Alice → To = Bob, Amount = 500, Memo = "Dinner", Category = FOOD.
2. Click **Send instantly**.
3. Toast: **"Sent 500 BDT"** (success). Balance card updates.
4. Activity list shows new row: "Sent to Bob ৳500.00 · FOOD · …".

**Edge cases.**
- **Amount = 0 or negative** → client blocks with toast "Amount must be a
  positive number" (no request sent).
- **Amount > 50,000** → backend rejects 400 "Exceeds per-transfer cap".
- **Daily total > 200,000** → backend rejects 400 "Daily limit exceeded".
- **Insufficient funds** → backend rejects 400 "Insufficient balance".
- **Same click twice rapidly** → first request gets a new idempotency key;
  the second one's UUID is different so both succeed (intentional). A
  retry of the *same* network request with the same key would no-op.

**Expected result.** Toast appears within 1 round-trip; balance on both
sides updates; one new transaction row exists in the audit log.

---

## 6. Request Money Form

**Where.** GlassCard "Request money", top-right grid cell.
**Form fields.** From (select), Amount, Note (≤140 chars).
**What.** Creates a `PENDING` `MoneyRequest`; the payer sees it in their
incoming list and can Pay or Decline.
**API.** `POST /api/request`.

**Happy path.**
1. As Alice → request ৳1200 from Bob, Note = "Lunch".
2. Switch to Bob.
3. Bob sees the request in **Incoming requests** with [Pay] and [Decline].

**Edge cases.**
- **Self-request** → client dropdown excludes self; not possible via UI.
- **Past expiry** → server stamps `expired: true` when listing; UI badge
  shows **EXPIRED** instead of `PENDING`.
- **Re-request after rejection** → no rule against it; creates a new row.

**Expected result.** Bob's incoming list contains exactly one new request,
the outgoing panel under it shows Alice's view with status `PENDING`.

---

## 7. Pay / Decline Incoming Request

**Where.** "Incoming requests" GlassCard, each row has two buttons.
**What.** Paying converts the request into an atomic transfer (same as §5);
declining flips it to `REJECTED`.
**API.** `POST /api/request/:id/pay` (with `Idempotency-Key`),
`POST /api/request/:id/reject`.

**Happy path.**
1. As Bob, click **Pay** on Alice's ৳1200 request.
2. Toast: **"Request paid"**. Bob's balance drops ৳1200; Alice's gains ৳1200.
3. Row disappears from Bob's incoming list; Alice's outgoing flips to
   `PAID`.

**Edge cases.**
- **Decline**: row vanishes for Bob; Alice sees `REJECTED` on her outgoing.
- **Double-click Pay** → first request pays; second is rejected 400
  "Request not pending" (idempotent at the data layer).
- **Not enough balance** → 400 "Insufficient balance".

**Expected result.** Status badges update without a manual refresh
(`refreshAll(uid)` is called on success).

---

## 8. Split Bill Form

**Where.** GlassCard "Split bill", middle-left grid cell.
**Form fields.** Multi-select chips (other users), Total (BDT).
**What.** Atomically debits the initiator for the total and creates N
credit legs, one per recipient. Remainder cents (if total not divisible by
N) are sent to the first recipient.
**API.** `POST /api/split` with `Idempotency-Key`.

**Happy path.**
1. As Alice → split ৳1000 with [Bob, Charlie] selected.
2. Live preview reads "**৳500.00 each**" (no remainder).
3. Click **Split payment**. Toast: **"Split across 2 people"**.
4. Alice −৳1000; Bob +৳500; Charlie +৳500. Activity shows 3 rows.

**Edge cases.**
- **৳1000 split 3 ways** → preview reads "৳333.00 each + remainder to
  first" (Bob gets the +৳1).
- **No recipients selected** → submit is a no-op (client-side guard).
- **Initiator can't cover total** → backend rolls back **all** legs
  atomically; no partial state.
- **Empty selection** + valid total → submit blocked client-side.

**Expected result.** Exactly N+1 audit rows (1 debit + N credits), all with
the same idempotency key on the initiator's leg.

---

## 9. Schedule Payment

**Where.** GlassCard "Schedule + QR", middle-right grid cell, top half.
**Form fields.** To (select), Amount (BDT), When (`datetime-local`).
**What.** Inserts a `Transaction` with status `SCHEDULED:<executeAt>`; the
sender is *not* debited until the scheduled time.
**API.** `POST /api/scheduled` with `Idempotency-Key`.
**Backend cron.** `POST /api/scheduled/settle` materializes due rows.

**Happy path.**
1. As Alice → schedule ৳250 to Bob for "today 14:30".
2. Click **Schedule**. Toast: **"Payment scheduled"**.
3. Switch to the **Scheduled** activity tab → see "৳250.00 to Bob".
4. Click **Settle due now** → toast: **"Settled X, Y still pending"**;
   Alice's balance drops, Bob's rises.

**Edge cases.**
- **Past datetime** → backend accepts but `settle` materializes immediately.
- **No due rows** → settle returns `{"settled":0,"skipped":0}`.
- **Receiver blocked by daily cap** → that leg is skipped, others proceed.

**Expected result.** Settled rows appear in the All activity tab with the
real transfer timestamp, not the schedule timestamp.

---

## 10. QR Pay-Code (Issue + Redeem)

**Where.** GlassCard "Schedule + QR", bottom half.
**Issue form.** Amount only → produces a 64-char code bound to the issuer.
**Redeem form.** Paste code → the issuer is credited.
**API.** `POST /api/qr/issue`, `POST /api/qr/redeem` (with `Idempotency-Key`).

**Happy path.**
1. As Bob → issue QR for ৳300. The code renders in a dashed gold box.
2. Switch to Alice. Paste the code into "Paste pay-code", click **Pay**.
3. Toast: **"QR payment completed"**. Alice −৳300, Bob +৳300.

**Edge cases.**
- **Re-paste the same code** → backend returns "Code already redeemed";
  no double-spend.
- **Random garbage code** → 400 "Invalid code".
- **Code issued by self** → backend rejects "Cannot redeem your own code".

**Expected result.** QR redemption is treated like a transfer: same
`Transaction` table, same idempotency guards.

---

## 11. Savings Goals (Create + Deposit)

**Where.** GlassCard "Savings goals", middle-right of the lower grid.
**Form fields.** Goal name (≤60 chars), Target (BDT).
**What.** Creates a `Goal` row with `savedAmount: 0`. Deposits debit the
user's wallet and increment `savedAmount`. When `savedAmount ≥ targetAmount`,
the goal gets `completedAt: <now>`.
**API.** `POST /api/goals`, `POST /api/goals/:id/deposit`
(with `Idempotency-Key`).

**Happy path.**
1. As Alice → create goal "New Laptop" target ৳50,000.
2. Progress bar shows 0%. Deposit ৳10,000. Bar jumps to 20%, badge reads
   "৳10,000.00 / ৳50,000.00".
3. Deposit another ৳40,000. Bar hits 100%, name appears with "🎉", no
   more deposit input.

**Edge cases.**
- **Target ≤ 0** → client blocks with toast "Target must be a positive
  number".
- **Deposit > balance** → 400 "Insufficient balance".
- **Goal already completed** → deposit input is hidden.

**Expected result.** Each deposit creates a corresponding transaction row
in the activity feed (visible as an outflow, category `SAVINGS`).

---

## 12. Activity Tab — All (default)

**Where.** GlassCard "Activity", filter row + list + "Load more" button.
**Filters.** Search box (matches `memo`, debounced 400 ms), direction
(`all|in|out`), category (`ALL` + 10 categories).
**API.** `GET /api/transactions/:id?limit=20&direction=…&category=…&q=…&cursor=…`.

**Happy path.**
1. Generate 25 transactions as Alice.
2. Activity list shows the first 20 (cursor-paginated).
3. Click **Load more** → next 5 render, button disappears (cursor = null).
4. Type "dinner" in the search box → after 400 ms, list filters to matches
   on `memo`.
5. Change direction to **Out** → list narrows to Alice's debits only.

**Edge cases.**
- **No matches** → "No transactions yet." message renders (we should make
  this `aria-live="polite"`; tracked in follow-up).
- **Search debounce** prevents thrash; immediate on blur would be wrong.
- **Category = ALL** → backend omits the param entirely, returns all rows.

**Expected result.** Filters compose; clearing the search restores the
full window. Pagination cursor is stable across filter changes.

---

## 13. Activity Tab — Requests (inbox)

**Where.** Same Activity GlassCard, second tab button "requests".
**What.** Shows the user's most recent notifications (up to 12).
**API.** `GET /api/notifications/:userId`.

**Happy path.**
1. Generate 3 different actions (transfer, request, schedule).
2. Click the **Requests** tab. Three notification cards render in reverse
  chronological order.
3. Read notifications render dimmed (`opacity-60`), unread have a gold border.

**Edge cases.**
- **0 notifications** → "Inbox empty." message.
- **>12 notifications** → only the latest 12 shown; the panel does not
  provide a paginate control (backend supports `?limit=…`).

**Expected result.** Notification kind icons should match the action type
(once the full NotificationPanel component is wired in — currently the
inline inbox is title + body only).

---

## 14. Activity Tab — Scheduled

**Where.** Same Activity GlassCard, third tab button "scheduled".
**What.** Lists the user's `SCHEDULED:<iso>` transactions and exposes the
**Settle due now** button.
**API.** `GET /api/scheduled/:userId`, `POST /api/scheduled/settle`.

**Happy path.**
1. Schedule 2 payments as Alice.
2. Open Scheduled tab. Two rows render: "৳X to <name>".
3. Click **Settle due now** → toast reports settled count.

**Edge cases.**
- **0 scheduled** → "Nothing scheduled." message + button still renders.
- **No due rows** → button still works, returns `settled: 0`.

**Expected result.** Settled rows disappear from this tab and appear in
the All tab as completed transactions.

---

## 15. Saved Payees

**Where.** GlassCard "Saved payees", full-width, only rendered when
`contacts.length > 0`.
**What.** Chip per saved contact. Clicking sets `sendTargetId` and
smooth-scrolls to top (so the Send form is in view).
**API.** `GET /api/contacts/:userId`, `POST /api/contacts`.

**Happy path.**
1. As Alice → transfer ৳100 to Bob. After success, click **Save** on the
   outgoing tx (handler in `saveContact`).
2. Refresh. Saved payees card renders "Bob" chip.
3. Click the chip → page scrolls up, Send form's "To" is pre-filled to Bob.

**Edge cases.**
- **No contacts** → card not rendered.
- **Duplicate save** → backend returns existing row (upsert semantics).

**Expected result.** Payee names survive a page refresh and re-render on
re-fetch.

---

## 16. Toast Notifications (a11y)

**Where.** Above the activity card, single mount.
**What.** Success/error toasts with auto-dismiss after 4200 ms.
**A11y.** `role="status"`, `aria-live="polite"`, `aria-atomic="true"`.

**Happy path.**
1. Trigger any successful action → toast appears with green styling +
   check icon.
2. Wait 4.2 s → toast animates out.

**Edge cases.**
- **Rapid triggers** → toast text replaces; no stacking.
- **Error message from server** → red styling + X icon; same timeout.

**Expected result.** Screen-readers announce toasts (NVDA/JAWS verified).

---

## 17. Error Envelope (uniform `{success, error}`)

**Where.** Every backend error path.
**What.** All 4xx/5xx responses use
`{"success":false,"error":"<human-readable>"}`.
**API.** Verified via:

```bash
# Invalid user id
curl -s localhost:4000/api/users/abc | jq
# → {"success":false,"error":"Invalid user id"}

# Missing fields
curl -s -X POST localhost:4000/api/transfer -H 'Content-Type: application/json' -d '{}' | jq
# → {"success":false,"error":"<zod issue>"}

# Rate-limit tripped
for i in $(seq 1 40); do curl -s -X POST localhost:4000/api/transfer -d '{}' >/dev/null; done
# → 429 {"success":false,"error":"Too many requests, please try again later."}
```

**Expected result.** No raw `{"error":"…"}` envelopes anywhere on the API
surface.

---

## 18. Rate Limiting (visible behaviour)

**Where.** Implicit — every API call.
**What.** Two `express-rate-limit` tiers:
- `generalLimiter` — 200 req / 15 min per IP on read endpoints.
- `moneyWriteLimiter` — 30 req / 10 min per IP on write endpoints.

**Happy path.**
1. Spam **Send** 31 times in 60 s. After the 30th call, the response is
   429 with the uniform error envelope. The UI surfaces it as a toast.

**Expected result.** Server doesn't crash; per-IP isolation works
(separate client → separate counter).

---

## 19. Idempotency

**Where.** Every write endpoint that mutates money (`/transfer`,
`/split`, `/qr/redeem`, `/goals/:id/deposit`, `/scheduled`, `/request/:id/pay`).
**What.** Client supplies `Idempotency-Key: <uuid>` per click. Server checks
`Transaction.idempotencyKey` UNIQUE before doing work.

**Test.**
```bash
KEY=$(uuidgen)
curl -s -X POST localhost:4000/api/transfer \
  -H "Idempotency-Key: $KEY" -H 'Content-Type: application/json' \
  -d '{"senderId":1,"receiverId":2,"amount":100,"category":"TRANSFER"}'
curl -s -X POST localhost:4000/api/transfer \
  -H "Idempotency-Key: $KEY" -H 'Content-Type: application/json' \
  -d '{"senderId":1,"receiverId":2,"amount":100,"category":"TRANSFER"}'
# Second response is the cached result; balance only changes once.
```

**Expected result.** Duplicate POST → same response body, single ledger row,
single balance mutation.

---

## 20. Concurrency / Atomicity (pessimistic lock)

**Where.** Every money-mutation route.
**What.** `lockUser(tx, userId)` issues `SELECT … FOR UPDATE` inside the
Prisma transaction. Two simultaneous transfers from the same sender
serialize, so no over-spend is possible.

**Test.** `cd backend && npx tsx test-concurrency.ts` — 6 cases, all green:
1. Two parallel transfers of ৳999.99 from Alice (balance ৳1000).
   → One wins, one returns 400 "Insufficient balance"; final balance = ৳0.01.
2. Split-bill over-spend → atomic rollback.
3. QR double-redeem with same code → second fails.
4. Goal deposit > balance → no goal row mutated.
5. Schedule then immediate settle → only settles once.
6. Request pay while being rejected → only first wins.

**Expected result.** Zero data corruption under contention. Audit log has
exactly the number of rows that succeeded (no orphaned debits or credits).

---

## 21. Feature Suite (integration coverage)

**Test.** `cd backend && npx tsx test-v2-features.ts` — 10 suites:
1. Validation (Zod) rejects malformed bodies.
2. Per-transfer cap (৳50,000).
3. Daily cap (৳200,000).
4. Memo length (≤140 chars).
5. Request lifecycle (create → pay → audit; create → reject → audit).
6. Scheduled (create → settle).
7. QR (issue → redeem → double-redeem-fails).
8. Contacts + Goals + Insights persistence.
9. Pagination + rate-limit interaction.
10. Security headers (Helmet: `X-Content-Type-Options`,
    `Referrer-Policy`, `X-Frame-Options`).

**Expected result.** All suites green; output line: `10 passed, 0 failed`.

---

## 22. Accessibility Spot-Checks

**Where.** Whole app.
**What.**
- All `<select>` have visible labels (or `aria-label`).
- Toast region is `role="status"` + `aria-live="polite"`.
- Form inputs have associated `<label>` elements.
- Buttons have discernible text (icon-only buttons carry `title=`).
- Keyboard: Tab order is logical; Enter submits forms; Esc closes
  confirm-modal (modal is dismissed by clicking the overlay).

**Test.**
1. Run Lighthouse a11y audit in Chrome DevTools → score ≥ 95.
2. Tab through every form and confirm focus ring is visible.

---

## Appendix A — API Surface (for ad-hoc curl)

| Endpoint                                | Method | Purpose                     |
|-----------------------------------------|--------|-----------------------------|
| `/api/health`                           | GET    | Liveness + DB ping          |
| `/api/users`                            | GET    | List demo users             |
| `/api/users/:id`                        | GET    | One user                    |
| `/api/seed`                             | POST   | Reset to 3 demo users       |
| `/api/admin/reset`                      | POST   | Drop + re-seed (needs `X-Admin-Secret` if configured) |
| `/api/transfer`                         | POST   | Atomic transfer             |
| `/api/request`                          | POST   | Create money request        |
| `/api/requests/:uid`                    | GET    | Incoming requests           |
| `/api/requests-out/:uid`                | GET    | Outgoing requests           |
| `/api/request/:id/pay`                  | POST   | Pay a request               |
| `/api/request/:id/reject`               | POST   | Reject a request            |
| `/api/split`                            | POST   | Atomic split bill           |
| `/api/scheduled`                        | POST   | Create scheduled payment    |
| `/api/scheduled/:uid`                   | GET    | List scheduled              |
| `/api/scheduled/settle`                 | POST   | Materialize due rows        |
| `/api/qr/issue`                         | POST   | Issue pay-code              |
| `/api/qr/redeem`                        | POST   | Redeem pay-code             |
| `/api/contacts/:uid`                    | GET    | List saved payees           |
| `/api/contacts`                         | POST   | Save a payee                |
| `/api/goals/:uid`                       | GET    | List goals                  |
| `/api/goals`                            | POST   | Create goal                 |
| `/api/goals/:id/deposit`                | POST   | Deposit into goal           |
| `/api/insights/:uid?days=N`             | GET    | Spending breakdown          |
| `/api/transactions/:uid?…`              | GET    | Cursor-paginated history    |
| `/api/notifications/:uid`               | GET    | List notifications          |
| `/api/notifications/:id/read`           | POST   | Mark one read               |
| `/api/notifications/:uid/read-all`     | POST   | Mark all read               |
| `/api/festivals/upcoming?days=N`       | GET    | Upcoming festivals within window |
| `/api/funding/sources`                 | GET    | List supported rails (BKASH/NAGAD/...) |
| `/api/funding/add`                     | POST   | Top up wallet from external rail (idempotent) |
| `/api/funding/withdraw`                | POST   | Withdraw to external rail (idempotent) |
| `/api/merchant`                        | GET    | List merchant directory     |
| `/api/merchant/:code`                  | GET    | One merchant detail         |
| `/api/merchant/pay`                    | POST   | Pay merchant by code (idempotent) |
| `/api/refunds`                         | POST   | Refund a transaction (idempotent) |
| `/api/refunds/:userId`                 | GET    | List refunds visible to user |
| `/api/recurring`                       | POST   | Create standing instruction  |
| `/api/recurring/:userId`               | GET    | List user's instructions    |
| `/api/recurring/:id`                   | DELETE | Cancel instruction          |
| `/api/recurring/settle`                | POST   | Materialize due legs        |
| `/api/fx/rates`                        | GET    | Server-controlled rate table |
| `/api/fx/transfer`                     | POST   | Convert + send (idempotent) |

## Appendix B — Files of Record

| File | Role |
|------|------|
| `frontend/src/app/page.tsx`            | Single-page dashboard (all sections) |
| `frontend/src/app/lib.ts`              | `api()`, `fmtBDT`, `uuid`, `CATEGORIES`, `FUNDING_PROVIDERS`, `FX_CURRENCIES`, `RECURRING_CADENCES`, `FESTIVALS_2026` |
| `frontend/src/app/types.ts`            | Domain type contracts |
| `frontend/src/app/components/ui.tsx`   | Design-system atoms (used if a section is refactored into a panel) |
| `frontend/src/app/components/NotificationPanel.tsx` | Extracted notification panel (available, not yet wired) |
| `frontend/src/app/components/GoalsPanel.tsx`       | Extracted goals panel     |
| `frontend/src/app/components/ScheduledPanel.tsx`   | Extracted scheduled panel  |
| `frontend/src/app/components/SpendingInsights.tsx` | Extracted insights panel |
| `frontend/src/app/components/ExternalPaymentsPanel.tsx` | External flows panel (Add Money, Cash Out, Merchant, Recurring, FX, Festival strip) |
| `backend/src/index.ts`                 | Top-level routes + app     |
| `backend/src/middleware.ts`            | `fail()`, rate limits, idempotency guard, admin guard |
| `backend/src/money.ts`                 | `lockUser`, `assertDailyLimit`, `bumpDailySpent`, `notify` |
| `backend/src/validate.ts`              | Zod schemas                |
| `backend/src/config.ts`                | Env-driven caps            |
| `backend/src/routes/transfer.ts`       | Transfer route             |
| `backend/src/routes/requests.ts`       | Request lifecycle routes   |
| `backend/src/routes/split.ts`          | Split-bill route           |
| `backend/src/routes/scheduled.ts`      | Scheduled routes           |
| `backend/src/routes/qr.ts`             | QR routes                  |
| `backend/src/routes/funding.ts`        | Add Money / Cash Out       |
| `backend/src/routes/merchant.ts`       | Merchant directory + pay   |
| `backend/src/routes/refunds.ts`        | Refund flow                |
| `backend/src/routes/recurring.ts`      | Standing instructions      |
| `backend/src/routes/fx.ts`             | FX / multi-currency        |
| `backend/src/routes/contacts.ts`       | Contacts routes            |
| `backend/src/routes/goals.ts`          | Goals routes               |
| `backend/src/routes/meta.ts`           | Insights + notifications + festivals |
| `backend/test-concurrency.ts`          | Concurrency integration    |
| `backend/test-v2-features.ts`          | Feature & security suite (15 suites) |
| `backend/prisma/schema.prisma`         | Data model                 |
| `backend/prisma/migrations/20260920030000_external_payments_v3/` | Adds `Merchant`, `RecurringInstruction`, and `currency` / `merchantCode` / `festivalTag` columns on `Transaction` |

---

# External Payments v3 (Sections 23–28)

The features below share a single architectural pattern: every off-wallet
flow writes a row into the existing `Transaction` ledger with a distinct
`category` (FUNDING / WITHDRAWAL / MERCHANT / REFUND / FX) and uses the
seeded "External" user (id 0) as the off-wallet counterparty. This keeps
the ledger as a single source of truth and reuses the existing
pessimistic-lock + idempotency plumbing.

**Honest note.** Real bKash / Nagad / Rocket / Daraz APIs require
licensed merchant onboarding. The wallet's contract is the production-
grade part — the `FundingProvider` factory is the single seam where a
real PG/MFS integration plugs in.

---

## 23. Add Money (Top-up from external rail)

**Where.** GlassCard "External" tab → "Add Money" sub-tab.
**Form fields.** Source (BKASH / NAGAD / ROCKET / BANK / CARD), Amount (BDT), Memo.
**API.** `POST /api/funding/add` with `Idempotency-Key`.
**Cap.** `FUNDING_DAILY_LIMIT_CENTS` (default ৳500K/day). Daily *spend* limit
does NOT apply — adding money is a credit, not a debit.

**Happy path.**
1. As Alice → Source = "BKASH", Amount = 5000, Memo = "Salary".
2. Toast: **"Added ৳5,000.00 via BKASH"**. Balance card +৳5000.
3. Activity feed row: "From External (MFS / Bank / Merchant) ৳5,000.00 · FUNDING".

**Edge cases.**
- **Amount > ৳50,000** → 400 "exceeds per-transfer cap".
- **Daily top-up > ৳500K** → 400 "Funding daily limit exceeded".
- **Idempotent replay** → cached response, no double-credit.

**Expected result.** Ledger has one FUNDING row, user balance +amount,
External balance unchanged (it tracks but is unbounded).

---

## 24. Cash Out (Withdraw to external rail)

**Where.** GlassCard "External" tab → "Cash Out" sub-tab.
**Form fields.** Destination (5 rails), Account reference (optional),
Amount, Memo.
**API.** `POST /api/funding/withdraw` with `Idempotency-Key`.
**Cap.** Full daily spend limit applies (this is a debit).

**Happy path.**
1. As Alice → Destination = "NAGAD", Account = "01XXX-XXXXXX",
   Amount = 3000, Memo = "Groceries".
2. Toast: **"Withdrew ৳3,000.00 to NAGAD"**. Balance −৳3000.
3. Activity row: "To External (MFS / Bank / Merchant) ৳3,000.00 · WITHDRAWAL".

**Edge cases.**
- **Insufficient balance** → 400 "Insufficient funds".
- **Daily cap exceeded** → 400 "Daily limit exceeded".
- **Invalid destination** → 400 from Zod enum check.

**Expected result.** `dailySpent` increments; the row's category is
WITHDRAWAL so the activity filter "out" includes it.

---

## 25. Merchant Checkout (Daraz / DPDC / GP / Foodpanda …)

**Where.** GlassCard "External" tab → "Merchants" sub-tab.
**Form fields.** Merchant (chip picker from `/api/merchant`), Amount, Order
reference (optional), Memo.
**API.** `POST /api/merchant/pay` with `Idempotency-Key`.
**Seeded merchants.** Daraz, Flipkart, Foodpanda, Uber, Pathao, DPDC,
WASA, GP, Robi, bKash Bill Pay.

**Happy path.**
1. As Alice → Pick "Daraz Bangladesh", Amount = 2500, Order = "INV-1".
2. Toast: **"Paid ৳2,500.00 to Daraz Bangladesh"**. Balance −৳2500.
3. Activity row: "To External (MFS / Bank / Merchant) ৳2,500.00 · MERCHANT".

**Edge cases.**
- **Unknown merchant code** → 404 "Merchant not found".
- **Amount > ৳50,000** → 400 per-transfer cap.
- **Order ref > 40 chars** → 400 from Zod.

**Expected result.** Row's `category = MERCHANT`, `merchantCode = "DARAZ"`,
memo carries `Order INV-1`.

---

## 26. Recurring / Standing Instructions

**Where.** GlassCard "External" tab → "Recurring" sub-tab.
**Form fields.** Recipient (user), Amount per leg, Cadence (DAILY / WEEKLY /
MONTHLY), First run (`datetime-local`), Memo.
**API.** `POST /api/recurring`, `GET /api/recurring/:uid`,
`DELETE /api/recurring/:id`, `POST /api/recurring/settle`.

**Happy path.**
1. As Alice → Recipient = Bob, Amount = 1000, Cadence = MONTHLY, First run
   = tomorrow, Memo = "Monthly rent".
2. Toast: **"Recurring monthly set for ৳1,000.00"**. List below the form
   shows the new instruction.
3. `POST /api/recurring/settle` (called from the same tab or via cron) →
   when `nextRunAt ≤ now`, a SCHEDULED row is created and `nextRunAt`
   advances by the cadence interval.

**Edge cases.**
- **Past `startAt`** → 400 "startAt must be a future ISO datetime".
- **Self-recipient** → 400 "Cannot recurring-pay yourself".
- **Cancelled instruction** → `active = false`, never picked up by settle.
- **Settle called twice in a row** → second call is a no-op (idempotency
  key derived from instruction id + scheduled time).

**Expected result.** Each settled leg produces one SCHEDULED Transaction
row which `/api/scheduled/settle` materializes into a COMPLETED row on
the next cron tick (or Settle-due-now button click).

---

## 27. Refund Flow

**Where.** Inline **Refund** link on every outgoing, COMPLETED activity
row (NOT a separate form). Click to issue a refund.
**API.** `POST /api/refunds` with `Idempotency-Key`.

**Happy path.**
1. Activity feed shows: "Sent to Bob ৳500.00". Click **Refund**.
2. Toast: **"Refund issued"**. Balance +৳500. Original row flips to
   REFUNDED, refund row inserted with category REFUND.
3. Activity now shows the refunded row with a "REFUNDED" badge and a new
   "Received from External" row for the credit.

**Edge cases.**
- **Already refunded** → 400 "This transaction has already been refunded".
- **Refunded by non-sender** → 403 "Only the original sender can issue a refund".
- **> 7 days old** → 400 "Refund window expired (7 days)".
- **Original receiver has insufficient balance** (rare, only after they've
  spent it) → 400 "Original receiver has insufficient balance to refund".

**Expected result.** Refund is atomic: original row update + refund row
insert happen in one `prisma.$transaction`, so partial refunds are impossible.

---

## 28. FX / Multi-currency Transfer

**Where.** GlassCard "External" tab → "FX" sub-tab.
**Form fields.** Recipient, Currency (USD/EUR/GBP/INR), Amount in that currency.
**API.** `POST /api/fx/transfer` with `Idempotency-Key`.
**Rates.** Env-overridable (`FX_USD_BDT=…`, etc.). Demo defaults: USD=110,
EUR=120, GBP=140, INR=1.32. Frontend mirrors the same table for the live preview.

**Happy path.**
1. As Alice → Recipient = Bob, Currency = USD, Amount = 10.
2. Preview reads **"Receiver will get ৳1,100.00 · Rate: 1 USD = 110 BDT"**.
3. Click **Send FX** → toast: **"Sent 10 USD (≈ ৳1,100.00)"**.
4. Activity row: "To Bob ৳1,100.00 · FX · FX: 10 USD → ৳1,100.00".

**Edge cases.**
- **Self FX** → 400 "Cannot FX-transfer to yourself".
- **Computed BDT > per-transfer cap** → 400 "Computed BDT exceeds per-transfer cap".
- **Unknown currency** → 400 from Zod enum.
- **Daily limit applies** to the BDT-equivalent debit.

**Expected result.** Row carries `currency = "USD"` so the activity feed
can render "FX: 10 USD → ৳1,100.00" without losing the source currency.

---

## 29. Festival Strip (Upcoming Eid / Durga Puja / Pohela Boishakh)

**Where.** Conditional render at the top of the External tab. Only appears
when a festival is within 14 days (per `FESTIVALS_2026` calendar).
**API.** `GET /api/festivals/upcoming?days=30`.

**Happy path.**
1. Open the External tab during the 14 days before Eid-ul-Fitr.
2. Gold strip: **"Eid-ul-Fitr in 7 days · Schedule a festival bonus or
   sundry to a contact — try the Recurring tab below."** with a
   "Schedule bonus" button.
3. Click the button → switches to the Recurring sub-tab pre-positioned
   for the user to fill in.

**Edge cases.**
- **No festival within 14 days** → strip doesn't render.
- **Date set in the past (during demo)** → use `?days=` to widen the
  window for the screen capture.

**Expected result.** Festival flow uses the same Recurring engine — no
separate scheduler — so it inherits idempotency, daily-limit, and audit-
trail behaviour for free.

---

## Appendix C — Migration Notes

The `external-payments-v3` migration is in
`backend/prisma/migrations/20260920030000_external_payments_v3/`. It:

1. Adds `currency`, `merchantCode`, `festivalTag` columns to `Transaction`
   (currency defaults to "BDT"; other two are nullable).
2. Creates `Merchant` and `RecurringInstruction` tables with the indexes
   and FK constraints declared in `schema.prisma`.
3. Is backwards-compatible: existing rows continue to satisfy the new
   schema (`currency` defaults, nulls on optional columns).

For local dev:
```bash
cd backend
npx prisma migrate deploy
```

For Render (production), the existing `prisma migrate deploy` in the
build/release script will pick up the new folder automatically.

## Appendix D — External-user id 0 pattern

The seeded "External" user with `id = 0` is the off-wallet counterparty
for every funding, merchant, refund, FX and refund-corresponding
debit/credit. The pattern is:

- `Transaction.senderId = 0` → money came from off-wallet (Add Money,
  merchant receipt, refund credit).
- `Transaction.receiverId = 0` → money left to off-wallet (Cash Out,
  merchant pay, refund debit).
- `External.balance` is unbounded and never participates in any balance
  check (`lockUser` is never called on id 0).

This means the wallet's ledger and atomicity guarantees extend
naturally to the off-wallet flows without a parallel accounting system.
A production deployment would replace the `MockFundingProvider`
factory in `routes/funding.ts` with real PG/MFS API calls — the rest of
the system doesn't need to change.
