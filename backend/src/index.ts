import express from 'express';
import cors from 'cors';
import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const prisma = new PrismaClient();
const PORT = process.env.PORT || 4000;

app.use(cors());
app.use(express.json());

// ==========================================
// HEALTH CHECK
// Lightweight endpoint the frontend can ping on mount to wake up
// the Render free-tier service before any real work is attempted.
// Pings the DB so the response also doubles as a connectivity probe.
// ==========================================
app.get('/api/health', async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ status: 'ok', db: 'reachable' });
  } catch (error: any) {
    res.status(503).json({ status: 'degraded', db: 'unreachable', error: error?.message });
  }
});

// ==========================================
// MOCK AUTH: List Users
// ==========================================
app.get('/api/users', async (req, res) => {
  try {
    const users = await prisma.user.findMany({
      select: { id: true, name: true, balance: true }
    });
    res.json(users);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

// ==========================================
// SEND MONEY (P2P Transfer)
// ==========================================
app.post('/api/transfer', async (req, res) => {
  const { senderId, receiverId, amount } = req.body;
  const idempotencyKey = req.headers['idempotency-key'] as string;

  if (!idempotencyKey) {
    return res.status(400).json({ error: 'Idempotency-Key header is required' });
  }

  if (!Number.isInteger(amount) || amount <= 0) {
    return res.status(400).json({ error: 'Amount must be a positive integer (cents)' });
  }

  if (senderId === receiverId) {
    return res.status(400).json({ error: 'Cannot send money to yourself' });
  }

  try {
    // 1. Check Idempotency (has this transaction already been processed?)
    const existingTx = await prisma.transaction.findUnique({
      where: { idempotencyKey }
    });

    if (existingTx) {
      return res.json({ success: true, transactionId: existingTx.id, message: 'Returned cached result' });
    }

    // 2. Perform ACID Transaction with Pessimistic Locking
    const result = await prisma.$transaction(async (tx) => {
      // Lock the sender's row so concurrent requests wait
      const sender = await tx.$queryRaw<any[]>`
        SELECT id, balance FROM "User" WHERE id = ${senderId} FOR UPDATE;
      `;

      if (sender.length === 0) {
        throw new Error('Sender not found');
      }

      if (sender[0].balance < amount) {
        throw new Error('Insufficient funds');
      }

      const receiver = await tx.user.findUnique({ where: { id: receiverId } });
      if (!receiver) {
        throw new Error('Receiver not found');
      }

      // Deduct from sender
      await tx.user.update({
        where: { id: senderId },
        data: { balance: { decrement: amount } }
      });

      // Credit to receiver
      await tx.user.update({
        where: { id: receiverId },
        data: { balance: { increment: amount } }
      });

      // Log transaction
      const transaction = await tx.transaction.create({
        data: {
          senderId,
          receiverId,
          amount,
          status: 'COMPLETED',
          idempotencyKey
        }
      });

      return transaction;
    });

    res.json({ success: true, transactionId: result.id });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// ==========================================
// REQUEST MONEY
// ==========================================
app.post('/api/request', async (req, res) => {
  const { requesterId, payerId, amount } = req.body;

  if (!Number.isInteger(amount) || amount <= 0) {
    return res.status(400).json({ error: 'Amount must be a positive integer (cents)' });
  }
  if (requesterId === payerId) {
    return res.status(400).json({ error: 'Cannot request money from yourself' });
  }

  try {
    const moneyRequest = await prisma.moneyRequest.create({
      data: { requesterId, payerId, amount, status: 'PENDING' }
    });
    res.json({ success: true, requestId: moneyRequest.id });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to create request' });
  }
});

// ==========================================
// FETCH PENDING REQUESTS FOR A USER
// ==========================================
app.get('/api/requests/:userId', async (req, res) => {
  const userId = parseInt(req.params.userId);
  try {
    const requests = await prisma.moneyRequest.findMany({
      where: { payerId: userId, status: 'PENDING' },
      include: { requester: { select: { name: true } } }
    });
    res.json(requests);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch requests' });
  }
});

// ==========================================
// PAY A MONEY REQUEST
// ==========================================
app.post('/api/request/:id/pay', async (req, res) => {
  const requestId = parseInt(req.params.id);
  const { payerId } = req.body;
  const idempotencyKey = req.headers['idempotency-key'] as string;

  if (!idempotencyKey) {
    return res.status(400).json({ error: 'Idempotency-Key header is required' });
  }

  try {
    // Check idempotency first (if already paid via this exact retry)
    const existingTx = await prisma.transaction.findUnique({
      where: { idempotencyKey }
    });

    if (existingTx) {
      return res.json({ success: true, transactionId: existingTx.id, message: 'Returned cached result' });
    }

    const result = await prisma.$transaction(async (tx) => {
      // Lock the request row
      const reqRows = await tx.$queryRaw<any[]>`
        SELECT id, "amount", "status", "requesterId", "payerId" 
        FROM "MoneyRequest" WHERE id = ${requestId} FOR UPDATE;
      `;

      if (reqRows.length === 0) throw new Error('Request not found');
      const moneyReq = reqRows[0];

      if (moneyReq.payerId !== payerId) throw new Error('Unauthorized payer');
      if (moneyReq.status !== 'PENDING') throw new Error('Request is no longer pending');

      // Lock the payer's row
      const payerRows = await tx.$queryRaw<any[]>`
        SELECT id, balance FROM "User" WHERE id = ${payerId} FOR UPDATE;
      `;

      if (payerRows.length === 0) throw new Error('Payer not found');
      if (payerRows[0].balance < moneyReq.amount) throw new Error('Insufficient funds');

      // Deduct payer
      await tx.user.update({
        where: { id: payerId },
        data: { balance: { decrement: moneyReq.amount } }
      });

      // Credit requester
      await tx.user.update({
        where: { id: moneyReq.requesterId },
        data: { balance: { increment: moneyReq.amount } }
      });

      // Update request status
      await tx.moneyRequest.update({
        where: { id: requestId },
        data: { status: 'PAID' }
      });

      // Log transaction
      const transaction = await tx.transaction.create({
        data: {
          senderId: payerId,
          receiverId: moneyReq.requesterId,
          amount: moneyReq.amount,
          status: 'COMPLETED',
          idempotencyKey
        }
      });

      return transaction;
    });

    res.json({ success: true, transactionId: result.id });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// ==========================================
// TRANSACTION HISTORY
// Returns all transactions where the user is either sender or receiver,
// most recent first. Each row includes the counterparty name so the
// frontend doesn't need a second round-trip to look it up.
// Settled money requests already produce a Transaction row inside
// /api/request/:id/pay, so they naturally show up here.
// ==========================================
app.get('/api/transactions/:userId', async (req, res) => {
  const userId = parseInt(req.params.userId);
  try {
    const txs = await prisma.transaction.findMany({
      where: {
        OR: [{ senderId: userId }, { receiverId: userId }]
      },
      orderBy: { createdAt: 'desc' },
      include: {
        sender:   { select: { id: true, name: true } },
        receiver: { select: { id: true, name: true } }
      }
    });
    res.json(txs);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// SPLIT BILL / GROUP PAYMENT
// One atomic operation: debit the initiator's full total once, then
// credit each recipient an equal share inside the same DB transaction.
// If any step fails (e.g. insufficient balance, unknown recipient, DB
// error) the entire split rolls back -- no partial transfers.
// Supports Idempotency-Key like single transfer: accidental double-
// submits return the cached result instead of moving the money twice.
// Body: { initiatorId, recipientIds: number[], totalAmount: number (cents) }
// ==========================================
app.post('/api/split', async (req, res) => {
  const { initiatorId, recipientIds, totalAmount } = req.body;
  const idempotencyKey = req.headers['idempotency-key'] as string;

  if (!idempotencyKey) {
    return res.status(400).json({ error: 'Idempotency-Key header is required' });
  }
  if (!Array.isArray(recipientIds) || recipientIds.length === 0) {
    return res.status(400).json({ error: 'recipientIds must be a non-empty array' });
  }
  if (!Number.isInteger(totalAmount) || totalAmount <= 0) {
    return res.status(400).json({ error: 'totalAmount must be a positive integer (cents)' });
  }
  // Reject NaN, Infinity, and non-integer (float) IDs explicitly so a
  // bad request fails with a clear 400 instead of crashing inside Prisma
  // with a confusing "invalid input syntax for type integer" error.
  if (
    recipientIds.some(
      (id: unknown) => typeof id !== 'number' || !Number.isFinite(id) || !Number.isInteger(id)
    )
  ) {
    return res.status(400).json({ error: 'recipientIds must contain integer user IDs' });
  }
  if (recipientIds.includes(initiatorId)) {
    return res.status(400).json({ error: 'Cannot split a bill to yourself' });
  }
  // De-duplicate recipients so a multi-select can't double-credit someone
  const uniqueRecipientIds: number[] = Array.from(new Set<number>(recipientIds as number[]));
  if (uniqueRecipientIds.length !== recipientIds.length) {
    return res.status(400).json({ error: 'recipientIds contains duplicates' });
  }

  try {
    // 1. Idempotency: a whole split is one logical operation, keyed by a
    //    single Idempotency-Key. We store per-leg keys as `${key}:leg:N`,
    //    so on replay we look up the first leg's key as the marker that
    //    the split already ran, and return a cached-style response.
    const existingTx = await prisma.transaction.findUnique({
      where: { idempotencyKey: `${idempotencyKey}:leg:0` }
    });
    if (existingTx) {
      return res.json({
        success: true,
        splitTransactionIds: [existingTx.id],
        message: 'Returned cached result'
      });
    }

    // 2. One ACID transaction wrapping the entire split.
    //    Pessimistic lock on the initiator's row up-front so concurrent
    //    transfers or splits can't race against us.
    const result = await prisma.$transaction(async (tx) => {
      const initRows: Array<{ id: number; balance: number }> =
        await tx.$queryRaw`SELECT id, balance FROM "User" WHERE id = ${initiatorId} FOR UPDATE;`;
      if (initRows.length === 0) throw new Error('Initiator not found');
      if (initRows[0]!.balance < totalAmount) {
        throw new Error('Insufficient funds for full split');
      }

      // Verify every recipient exists before we touch any balances.
      // A single missing recipient should fail the whole split.
      const recipients = await tx.user.findMany({
        where: { id: { in: uniqueRecipientIds } },
        select: { id: true }
      });
      if (recipients.length !== uniqueRecipientIds.length) {
        throw new Error('One or more recipients not found');
      }

      // Debit initiator once for the full total.
      await tx.user.update({
        where: { id: initiatorId },
        data: { balance: { decrement: totalAmount } }
      });

      // Even-split: integer cents divided across N recipients.
      // Remainder cents go to the first recipient so the audit ledger
      // balances to the cent (totalAmount == sum of per-recipient credits).
      const share = Math.floor(totalAmount / uniqueRecipientIds.length);
      const remainder = totalAmount - share * uniqueRecipientIds.length;

      // Credit each recipient + log a Transaction row per recipient so
      // each leg shows up in the per-user history.
      const created: { id: number }[] = [];
      for (let i = 0; i < uniqueRecipientIds.length; i++) {
        const recipientId: number = uniqueRecipientIds[i]!;
        const recipientAmount = share + (i === 0 ? remainder : 0);

        await tx.user.update({
          where: { id: recipientId },
          data: { balance: { increment: recipientAmount } }
        });

        const t = await tx.transaction.create({
          data: {
            senderId: initiatorId as number,
            receiverId: recipientId,
            amount: recipientAmount,
            status: 'COMPLETED',
            // Per-leg idempotency keys must be unique, so we derive a
            // deterministic suffix from the split key + leg index.
            idempotencyKey: `${idempotencyKey}:leg:${i}`
          }
        });
        created.push({ id: t.id });
      }

      return created;
    });

    res.json({
      success: true,
      splitTransactionIds: result.map(t => t.id),
      recipientCount: uniqueRecipientIds.length
    });
  } catch (error: any) {
    // Race-safety: if a concurrent replay slips past the upfront lookup
    // and the per-leg unique constraint trips, treat it as a cached hit
    // rather than a 400 -- balances were rolled back atomically.
    if (error?.code === 'P2002') {
      return res.json({
        success: true,
        splitTransactionIds: [],
        message: 'Returned cached result (concurrent replay)'
      });
    }
    res.status(400).json({ error: error.message });
  }
});

// ==========================================
// Seed Test Users (Helper for hackathon)
// ==========================================
app.post('/api/seed', async (req, res) => {
  try {
    const count = await prisma.user.count();
    if (count === 0) {
      await prisma.user.createMany({
        data: [
          { name: 'Alice', balance: 10000000 },
          { name: 'Bob', balance: 10000000 },
          { name: 'Charlie', balance: 10000000 }
        ]
      });
      res.json({ success: true, message: 'Users seeded' });
    } else {
      res.json({ success: false, message: 'Users already exist' });
    }
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// Reset Demo State (Helper for hackathon)
// ==========================================
// Wipes transactions, money requests, and users, then re-seeds the three
// demo users at exactly 10,000,000 cents (100,000 BDT) each. Safe to call
// any number of times. Intended for resetting the demo environment between
// sessions — there is no real data to preserve, and the audit ledger must
// match the user balances, so a clean wipe is the only safe recovery.
app.post('/api/admin/reset', async (req, res) => {
  try {
    await prisma.transaction.deleteMany({});
    await prisma.moneyRequest.deleteMany({});
    await prisma.user.deleteMany({});
    await prisma.user.createMany({
      data: [
        { name: 'Alice', balance: 10000000 },
        { name: 'Bob', balance: 10000000 },
        { name: 'Charlie', balance: 10000000 }
      ]
    });
    const users = await prisma.user.findMany({
      select: { id: true, name: true, balance: true },
      orderBy: { id: 'asc' }
    });
    res.json({ success: true, message: 'Demo state reset', users });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});


app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
