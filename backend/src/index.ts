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

  if (amount <= 0) {
    return res.status(400).json({ error: 'Amount must be greater than 0' });
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

  if (amount <= 0) {
    return res.status(400).json({ error: 'Amount must be greater than 0' });
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


app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
