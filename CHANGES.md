# PSTU Wallet — Change Log & Implementation Record

> PSTU IT Carnival 2026 · Hackathon Build  
> Last updated: 2026-09-20

---

## What Was Built

### Original State (before this session)
- Single `page.tsx` (~700 lines) with all UI in one file
- Send money, request money, split bill
- Basic transaction list (flat, no search)
- TypeScript error: `API_URL` not defined

### New State (after this session)
Full modular component architecture — 6 new files, zero regressions, zero TypeScript errors.

---

## File Structure

```
frontend/src/app/
├── types.ts                        # Shared domain types (User, Transaction, Goal, etc.)
├── lib.ts                          # API helper, formatters, CSV export, constants
├── page.tsx                        # Thin orchestrator shell (~350 lines)
└── components/
    ├── ui.tsx                      # Design-system atoms (Button, Input, Modal, Toast…)
    ├── NotificationPanel.tsx       # Bell + unread count + panel
    ├── SpendingInsights.tsx        # Donut chart + category breakdown
    ├── GoalsPanel.tsx              # Savings goals CRUD + deposits
    ├── ScheduledPanel.tsx          # Future-dated transfers
    ├── QRPanel.tsx                 # Generate & redeem QR codes
    └── TransactionHistory.tsx      # Paginated, searchable, filterable history + CSV
```

---

## Features Implemented

### 1. Confirm Modal (`ui.tsx` → `ConfirmModal`)
Every destructive/financial action (send, pay request, split, schedule, QR redeem, goal deposit) now shows a confirmation dialog **before** executing. The modal displays:
- Action title
- Human-readable description
- Formatted BDT amount
- Cancel / Confirm buttons with loading state

**Why it matters:** Prevents fat-finger transfers. Matches production UX of every real fintech app.

---

### 2. Notifications Bell (`NotificationPanel.tsx`)
- Real-time bell icon in the header with an unread count badge
- Auto-refreshes every 30 seconds + on open
- Click any notification to mark it read
- "Mark all read" bulk action
- Notification kinds mapped to icons: TRANSFER_IN, TRANSFER_OUT, REQUEST_IN, REQUEST_PAID, SPLIT_IN, GOAL_DONE, SYSTEM
- Closes on outside click

**Backend endpoints used:**
```
GET  /api/notifications/:userId          # fetch all
POST /api/notifications/:id/read         # mark single read
POST /api/notifications/:userId/read-all # mark all read
```

---

### 3. Spending Insights Chart (`SpendingInsights.tsx`)
- Recharts `PieChart` with `innerRadius` (donut style) + custom tooltip
- Category breakdown ranked by spend total
- Animated `ProgressBar` per category
- Day-range selector: 7d / 30d / 90d
- Color palette consistent with `CATEGORY_COLORS` constant in `lib.ts`

**Backend endpoint used:**
```
GET /api/insights/:userId?days=30
```

---

### 4. Savings Goals UI (`GoalsPanel.tsx`)
- Create a new named goal with a BDT target
- Deposit money into any active goal (uses idempotency key)
- Animated progress bar showing `savedAmount / targetAmount`
- Completed goals shown separately with a ✓ icon
- Confirm modal before every deposit

**Backend endpoints used:**
```
GET  /api/goals/:userId
POST /api/goals
POST /api/goals/:id/deposit   (Idempotency-Key required)
```

---

### 5. Scheduled Transfers UI (`ScheduledPanel.tsx`)
- Form: recipient, amount, category, memo, `datetime-local` picker
- Minimum date enforced to future-only (+ 1 min)
- Lists all pending scheduled transfers for the current user
- "Due" badge highlights transfers past their `executeAt` timestamp
- "Settle Due Now" button triggers `POST /api/scheduled/settle` — settles all past-due transfers atomically

**Backend endpoints used:**
```
GET  /api/scheduled/:userId
POST /api/scheduled              (Idempotency-Key required)
POST /api/scheduled/settle
```

---

### 6. QR Pay UI (`QRPanel.tsx`)
Two tabs:
- **Generate Code** — enter amount, server issues `pstuqr.<id>.<amount>.<nonce>` string; copy-to-clipboard button
- **Scan & Pay** — paste code, preview decoded amount, confirm + pay

No third-party image library required — the code string is the "QR" for the demo.

**Backend endpoints used:**
```
POST /api/qr/issue
POST /api/qr/redeem   (Idempotency-Key required)
```

---

### 7. Transaction Search & Filter + Pagination (`TransactionHistory.tsx`)
- Toggle-able filter bar (doesn't clutter the UI by default)
- Memo search with 350 ms debounce (no request spam)
- Direction filter: All / Received / Sent
- Category filter: all 10 categories
- Cursor-based pagination ("Load more" button)
- All filters reset and reload when the current user changes

**Backend query params used:**
```
GET /api/transactions/:userId?direction=in&category=FOOD&q=lunch&cursor=123&limit=25
```

---

### 8. Reject Money Request
- "Decline" button added alongside "Pay" in the pending requests card
- Calls `POST /api/request/:id/reject` with `{ payerId }`
- Optimistically removes the request from the list on success
- Error toast if rejection fails

---

### 9. CSV Export (`lib.ts` → `exportToCsv`)
- "Export" button in the Transaction History header
- Exports all currently-loaded transactions as a `.csv` file
- Columns: id, date, type (SENT/RECEIVED), amount, currency, category, memo, from, to, status
- Uses `Blob` + `URL.createObjectURL` — no server round-trip, instant download

---

### 10. Low Balance Warning
- Renders an amber warning banner when `balance < ৳5,000`
- `LOW_BALANCE_THRESHOLD_CENTS = 500_000` constant in `lib.ts` — easy to tune
- Animated in/out with Framer Motion
- Accessible: uses `role="alert"` so screen readers announce it

---

### 11. Send/Request/Split: Category + Memo Support
- Every action form now includes a category selector
- Memo/note field on send, request, split
- Values flow through to the backend and appear in spending insights + transaction list

---

## Design System (`components/ui.tsx`)
All atoms share the CSS tokens from `globals.css`. No hard-coded hex values in any component.

| Component       | What it does |
|-----------------|--------------|
| `Button`        | 4 variants: primary, secondary, ghost, danger. Built-in loading spinner. |
| `Input`         | Consistent focus ring, dark background, tabular-nums |
| `Select`        | Styled dropdown with custom caret |
| `Label`         | Uppercase tracking label |
| `GlassCard`     | The glassmorphism card container |
| `SectionHeader` | Icon + title + optional badge + optional action |
| `Badge`         | 4 tones: neutral, positive, warn, info |
| `Skeleton`      | Animated shimmer placeholder |
| `EmptyState`    | Icon + title + subtitle zero-state |
| `ProgressBar`   | ARIA-compliant animated bar |
| `ToastBanner`   | Animated toast with 3 tones |
| `ConfirmModal`  | Full-screen overlay confirmation dialog |

---

## Shared Utilities (`lib.ts`)
| Export | Purpose |
|--------|---------|
| `api<T>()` | Typed fetch wrapper, throws user-friendly errors |
| `fmtBDT()` | Formats cents as `৳1,00,000.00` (en-IN grouping) |
| `uuid()` | Idempotency key generator |
| `relativeDate()` | "3h ago", "2d ago", etc. |
| `exportToCsv()` | Client-side CSV download |
| `CATEGORY_COLORS` | Consistent color map for all 10 categories |
| `LOW_BALANCE_THRESHOLD_CENTS` | Configurable warning threshold |

---

## Running the Project

### Prerequisites
- Node.js 18+
- PostgreSQL (local or Docker)

### Backend
```bash
cd backend

# 1. Copy env
cp .env.example .env    # set DATABASE_URL

# 2. Install
npm install

# 3. Run migrations
npx prisma migrate deploy

# 4. Start
npm run dev             # listens on :4000
```

Or with Docker Compose (from project root):
```bash
docker-compose up
```

### Frontend
```bash
cd frontend

# 1. Set env
echo "NEXT_PUBLIC_API_URL=http://localhost:4000" > .env.local

# 2. Install
npm install

# 3. Start
npm run dev             # http://localhost:3000
```

### Seed demo users
After both services are running, visit:
```
POST http://localhost:4000/api/seed
```
Or click **"Seed demo data"** in the loading screen.

---

## Manual Testing Guide

### Test 1 — Send Money with Confirm Modal
1. Select **Alice** as current user
2. Go to **Send** tab → pick Bob → enter `500` → click **Send Instantly**
3. ✅ Confirm modal appears showing ৳500.00
4. Click **Confirm**
5. ✅ Toast: "Sent ৳500.00 successfully"
6. ✅ Alice's balance decreased; Bob's increased

### Test 2 — Notifications Bell
1. As Alice, send money to Bob
2. Switch user to **Bob**
3. ✅ Bell icon shows orange unread badge (count ≥ 1)
4. Click bell → panel opens → shows "Received ৳500.00"
5. Click notification → ✅ marks as read, dot disappears
6. "Mark all read" → ✅ all clear

### Test 3 — Request + Reject
1. As Bob, go to **Request** tab → request ৳1,000 from Alice → **Send Request**
2. Switch to **Alice**
3. ✅ Pending Requests card shows Bob's request
4. Click **Decline** → ✅ request disappears from list
5. Switch back to Bob → request shows no longer pending

### Test 4 — Spending Insights
1. As Alice, send multiple transactions with different categories (FOOD, TRANSPORT, BILLS)
2. Go to **Spending Insights** card
3. ✅ Donut chart reflects category distribution
4. Switch between **7d / 30d / 90d** → chart updates

### Test 5 — Savings Goals
1. As Alice, click **New Goal** → name "Emergency Fund" → target 10000 → **Create Goal**
2. ✅ Goal card appears with 0% progress bar
3. Enter `2500` in deposit field → click **Save**
4. ✅ Confirm modal → Confirm → progress bar jumps to 25%
5. ✅ Alice's balance decreased by ৳2,500

### Test 6 — Scheduled Transfer
1. Go to **Schedule** tab
2. Pick Bob, enter ৳300, set a time 1 minute in the future → **Schedule Transfer**
3. ✅ Appears in the pending list with "Pending" badge
4. Wait 1 minute (or set time in the past in the form, the badge turns "Due")
5. Click **Settle Due (1)** → ✅ transfer executes, balances update

### Test 7 — QR Pay
1. As Alice, go to **QR Pay** → **Generate Code** tab
2. Enter `800` → **Generate** → ✅ code string appears
3. Copy the code
4. Switch user to **Bob**
5. Go to **QR Pay** → **Scan & Pay** tab
6. Paste the code → ✅ amount preview shows ৳800.00
7. Click **Pay via QR Code** → Confirm → ✅ transfer completes

### Test 8 — Transaction Filter + CSV Export
1. As Alice, go to **Transaction History**
2. Click **Filters** → change direction to **Sent** → ✅ only outgoing shown
3. Search memo → ✅ list narrows in real-time (350 ms debounce)
4. Click **Export** → ✅ `.csv` file downloads

### Test 9 — Low Balance Warning
1. Open `lib.ts`, note `LOW_BALANCE_THRESHOLD_CENTS = 500_000` (৳5,000)
2. In the database, set a user's balance to something below 500_000
3. Reload the app as that user
4. ✅ Amber warning banner appears above the balance card

### Test 10 — Idempotency (duplicate prevention)
1. Open the browser Network tab
2. Submit a transfer; note the `Idempotency-Key` header
3. Replay the exact same request (same key) to the backend
4. ✅ Backend returns `{ success: true, message: "Returned cached result" }` — no double-debit

### Test 11 — Concurrent Transfer (race condition)
Run `ts-node backend/test-concurrency.ts` to fire 10 simultaneous transfers from the same account and verify only valid ones go through.

---

## Architecture Decisions

| Decision | Reasoning |
|----------|-----------|
| `SELECT ... FOR UPDATE` on every debit | Prevents overdraft under concurrent load |
| Idempotency key on all writes | Network retries won't double-debit |
| Cursor-based pagination | Stable under concurrent inserts (vs. OFFSET which drifts) |
| Client-side CSV export | Zero server cost; no temp file cleanup needed |
| Debounced search (350 ms) | Avoids spamming the backend on every keypress |
| CSS custom properties for colors | Single source of truth; components never hard-code hex values |
| Modular components, thin `page.tsx` | Each feature can be tested/reviewed in isolation |
| Framer Motion `AnimatePresence` | Smooth list mutations — items exit before next items animate in |

---

## Known Limitations (by design — hackathon scope)
- No real authentication: user selection is a UI dropdown (mock auth)
- No SMS / push notifications: in-app inbox only
- QR codes are text strings, not scannable images (no image vendor needed)
- Scheduled transfer settlement is manual (demo button) or needs a cron job in production
- Balance is in integer paisa (cents) — BDT has no sub-paisa subdivision so this is correct
