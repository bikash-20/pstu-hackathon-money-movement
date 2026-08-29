# PSTU IT Carnival 2026 - Money Movement Application

A reliable, highly-concurrent digital wallet application demonstrating fintech-grade transaction safety (pessimistic locking and idempotency) on a closed ecosystem.

## Live URLs
*   **Frontend (Vercel):** https://frontend-alpha-inky-87.vercel.app
*   **Backend API (Render):** *[Pending Deployment from Dashboard]*

## Architecture Highlights
*   **PostgreSQL** for strict ACID compliance and row-level locking (`SELECT ... FOR UPDATE`) to prevent double-spending race conditions.
*   **Idempotency Keys** to prevent duplicate transactions during network failures or retries.
*   **Integer/Cents** math to avoid floating-point precision errors.

## Project Structure
*   `/docs` - Comprehensive engineering documentation, PRD, API specs, and Q&A.
*   `/backend` - Node.js / Express API
*   `/frontend` - Next.js / React Web App

## Local Setup

### Prerequisites
*   Node.js (v18+)
*   PostgreSQL

### Backend
```bash
cd backend
npm install
# Set DATABASE_URL in .env
npx prisma migrate dev
npm run dev
```

### Frontend
```bash
cd frontend
npm install
npm run dev
```
