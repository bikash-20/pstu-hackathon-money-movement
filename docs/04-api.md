# 04 - API Documentation

## Base URL
`http://localhost:4000/api` (Local)
`https://<render-url>/api` (Prod)

## Endpoints

### 1. List Users (Mock Auth)
*   **GET** `/users`
*   **Response:**
    ```json
    [
      { "id": 1, "name": "Alice", "balance": 10000000 },
      { "id": 2, "name": "Bob", "balance": 10000000 }
    ]
    ```

### 2. Send Money (P2P Transfer)
*   **POST** `/transfer`
*   **Headers:** `Idempotency-Key: <uuid>`
*   **Body:**
    ```json
    {
      "senderId": 1,
      "receiverId": 2,
      "amount": 50000 // In cents (500 BDT)
    }
    ```
*   **Response (200 OK):**
    ```json
    { "success": true, "transactionId": 123 }
    ```

### 3. Request Money
*   **POST** `/request`
*   **Body:**
    ```json
    {
      "requesterId": 1,
      "payerId": 2,
      "amount": 120000 // In cents (1200 BDT)
    }
    ```
*   **Response (200 OK):**
    ```json
    { "success": true, "requestId": 456 }
    ```

### 4. Pay Money Request
*   **POST** `/request/:id/pay`
*   **Headers:** `Idempotency-Key: <uuid>`
*   **Body:**
    ```json
    {
      "payerId": 2
    }
    ```
*   **Response (200 OK):**
    ```json
    { "success": true, "transactionId": 124 }
    ```
