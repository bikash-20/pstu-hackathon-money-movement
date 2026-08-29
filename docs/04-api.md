# 04 - API Documentation

## Base URL
`http://localhost:4000/api` (Local)
`https://pstu-hackathon-backend.onrender.com/api` (Prod)

All endpoints are prefixed with `/api`. The frontend normalizes `NEXT_PUBLIC_API_URL` to always end in `/api`, so misconfigured environment variables route correctly regardless of whether the operator included the suffix.

---

## 1. List Users (Mock Auth)
*   **GET** `/users`
*   **Description:** Lists all registered users so the frontend's "Simulating As" dropdown can populate. Balances are in cents.
*   **Response (200 OK):**
    ```json
    [
      { "id": 1, "name": "Alice", "balance": 10000000 },
      { "id": 2, "name": "Bob", "balance": 10000000 },
      { "id": 3, "name": "Charlie", "balance": 10000000 }
    ]
    ```

---

## 2. Send Money (P2P Transfer)
*   **POST** `/transfer`
*   **Headers:** `Idempotency-Key: <uuid>` (required)
*   **Body:**
    ```json
    {
      "senderId": 1,
      "receiverId": 2,
      "amount": 50000
    }
    ```
    `amount` is in cents (e.g., `50000` = ৳500).
*   **Response (200 OK):**
    ```json
    { "success": true, "transactionId": 123 }
    ```
*   **Idempotent replay (200 OK):**
    ```json
    { "success": true, "transactionId": 123, "message": "Returned cached result" }
    ```
*   **Error cases (400):** missing `Idempotency-Key`, `amount <= 0`, `senderId === receiverId`, sender not found, receiver not found, insufficient funds.

---

## 3. Request Money
*   **POST** `/request`
*   **Body:**
    ```json
    {
      "requesterId": 1,
      "payerId": 2,
      "amount": 120000
    }
    ```
*   **Response (200 OK):**
    ```json
    { "success": true, "requestId": 456 }
    ```
*   **Error cases (400):** `amount <= 0`.

---

## 4. List Pending Requests for a User
*   **GET** `/requests/:userId`
*   **Description:** Returns all `MoneyRequest` rows where the user is the payer and status is `PENDING`. Includes the requester's name so the UI does not need a second round-trip.
*   **Response (200 OK):**
    ```json
    [
      {
        "id": 456,
        "requesterId": 1,
        "payerId": 2,
        "amount": 120000,
        "status": "PENDING",
        "createdAt": "2026-08-29T10:00:00.000Z",
        "requester": { "name": "Alice" }
      }
    ]
    ```

---

## 5. Pay a Money Request
*   **POST** `/request/:id/pay`
*   **Headers:** `Idempotency-Key: <uuid>` (required)
*   **Body:**
    ```json
    { "payerId": 2 }
    ```
*   **Response (200 OK):**
    ```json
    { "success": true, "transactionId": 124 }
    ```
*   **Idempotent replay (200 OK):**
    ```json
    { "success": true, "transactionId": 124, "message": "Returned cached result" }
    ```
*   **Error cases (400):** missing `Idempotency-Key`, request not found, `payerId` does not match the request's payer, request is no longer `PENDING`, payer not found, insufficient funds.
*   **Side effects:** Sets the `MoneyRequest.status` to `PAID` and writes one `Transaction` row with the payer as sender and the original requester as receiver.

---

## 6. Transaction History
*   **GET** `/transactions/:userId`
*   **Description:** Returns every `Transaction` row where the user is either sender or receiver, ordered most recent first. Includes counterparty names for direct UI use. Settled money requests (`POST /request/:id/pay`) also produce a `Transaction` row, so they appear in this history automatically.
*   **Response (200 OK):**
    ```json
    [
      {
        "id": 124,
        "senderId": 2,
        "receiverId": 1,
        "amount": 120000,
        "status": "COMPLETED",
        "createdAt": "2026-08-29T10:05:00.000Z",
        "sender":   { "id": 2, "name": "Bob" },
        "receiver": { "id": 1, "name": "Alice" }
      }
    ]
    ```

---

## 7. Split Bill (Atomic Group Payment)
*   **POST** `/split`
*   **Headers:** `Idempotency-Key: <uuid>` (required)
*   **Body:**
    ```json
    {
      "initiatorId": 1,
      "recipientIds": [2, 3, 4],
      "totalAmount": 150000
    }
    ```
    `totalAmount` is in cents. `recipientIds` must be a non-empty array of unique integers, none of which equals `initiatorId`.
*   **Response (200 OK):**
    ```json
    {
      "success": true,
      "splitTransactionIds": [201, 202, 203],
      "recipientCount": 3
    }
    ```
*   **Idempotent replay (200 OK):**
    ```json
    {
      "success": true,
      "splitTransactionIds": [201],
      "message": "Returned cached result"
    }
    ```
*   **Atomicity:** All recipient credits (and one `Transaction` row per recipient) happen inside a single Prisma `$transaction` with a `SELECT ... FOR UPDATE` lock on the initiator's row. If any step fails (insufficient funds, unknown recipient, DB error, race-condition unique constraint collision), the whole split rolls back.
*   **Remainder rule:** `share = floor(totalAmount / N)`. The leftover remainder cents go to the first recipient so that `sum(per-recipient credits) === totalAmount` to the cent.
*   **Error cases (400):** missing `Idempotency-Key`, empty `recipientIds`, non-integer `totalAmount`, `totalAmount <= 0`, non-numeric recipient IDs, initiator in recipient list, duplicates in `recipientIds`, initiator not found, any recipient not found, insufficient funds.

---

## 8. Seed Demo Data (Hackathon Helper)
*   **POST** `/seed`
*   **Description:** Inserts Alice, Bob, and Charlie at ৳100,000 each. Guarded by `prisma.user.count() === 0`, so it is a no-op if the table is already populated. Intended to be called once after the first deploy against an empty production database.
*   **Response (200 OK):**
    ```json
    { "success": true, "message": "Users seeded" }
    ```
    or, if users already exist:
    ```json
    { "success": false, "message": "Users already exist" }
    ```

---

## 9. Reset Demo State (Hackathon Helper)
*   **POST** `/admin/reset`
*   **Description:** Wipes `Transaction`, `MoneyRequest`, and `User` rows in foreign-key-safe order, then re-seeds Alice, Bob, Charlie at ৳100,000 each. Intended to be called between demo runs to reset to a known clean state. There is no real data to preserve in this closed ecosystem, and the audit ledger must always match the user balances, so a clean wipe is the only safe recovery path.
*   **Response (200 OK):**
    ```json
    {
      "success": true,
      "message": "Demo state reset",
      "users": [
        { "id": 1, "name": "Alice", "balance": 10000000 },
        { "id": 2, "name": "Bob", "balance": 10000000 },
        { "id": 3, "name": "Charlie", "balance": 10000000 }
      ]
    }
    ```
*   **Note:** Unauthenticated by design — Render's free tier does not provide a shell, so the team uses this endpoint as the only practical reset mechanism. See `06-decisions.md` Decision 5 for reasoning.