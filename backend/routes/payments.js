const express = require('express');
const { PrismaClient } = require('@prisma/client');
const { body, validationResult } = require('express-validator');
const authenticate = require('../middleware/authenticate');
const { sendPaymentReceipt } = require('../utils/whatsapp');

const router = express.Router();
const prisma = new PrismaClient();

router.use(authenticate);

// POST /api/payments - Record a payment
router.post(
  '/',
  [
    body('memberId').isUUID().withMessage('Valid member ID required'),
    body('amount').isFloat({ gt: 0 }).withMessage('Amount must be positive'),
    body('paymentMethod').isIn(['cash', 'upi', 'card']).withMessage('Invalid payment method'),
  ],
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { memberId, amount, paymentMethod, transactionRef } = req.body;

      const member = await prisma.member.findFirst({
        where: { id: memberId, isDeleted: false },
      });
      if (!member) return res.status(404).json({ error: 'Member not found' });

      // Create payment and update member balance atomically
      const [payment, updatedMember] = await prisma.$transaction(async (tx) => {
        const payment = await tx.payment.create({
          data: {
            memberId,
            amount: parseFloat(amount),
            paymentMethod,
            transactionRef: transactionRef || null,
          },
        });

        const newAmountPaid = parseFloat(member.amountPaid) + parseFloat(amount);
        const newRemaining = Math.max(0, parseFloat(member.remainingAmount) - parseFloat(amount));

        let paymentStatus = 'partial';
        if (newRemaining <= 0) paymentStatus = 'paid';

        const updatedMember = await tx.member.update({
          where: { id: memberId },
          data: {
            amountPaid: newAmountPaid,
            remainingAmount: newRemaining,
            paymentStatus,
          },
        });

        return [payment, updatedMember];
      });

      // Fire-and-forget WhatsApp mock notification
      sendPaymentReceipt(member.mobile, member.fullName, amount).catch(console.error);

      res.status(201).json({ data: payment, member: updatedMember });
    } catch (err) {
      next(err);
    }
  }
);

// GET /api/payments/summary - Revenue overview
// MUST be before /member/:id to avoid route conflict
router.get('/summary', async (req, res, next) => {
  try {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);

    const [totalRevenue, monthlyRevenue, lastMonthRevenue, recentPayments] = await Promise.all([
      prisma.payment.aggregate({ _sum: { amount: true } }),
      prisma.payment.aggregate({
        _sum: { amount: true },
        where: { paidAt: { gte: startOfMonth } },
      }),
      prisma.payment.aggregate({
        _sum: { amount: true },
        where: { paidAt: { gte: startOfLastMonth, lt: startOfMonth } },
      }),
      prisma.payment.findMany({
        take: 10,
        orderBy: { paidAt: 'desc' },
        include: { member: { select: { fullName: true, mobile: true } } },
      }),
    ]);

    res.json({
      data: {
        totalRevenue: totalRevenue._sum.amount || 0,
        monthlyRevenue: monthlyRevenue._sum.amount || 0,
        lastMonthRevenue: lastMonthRevenue._sum.amount || 0,
        recentPayments,
      },
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/payments/member/:id - Payment history for a member
router.get('/member/:id', async (req, res, next) => {
  try {
    const payments = await prisma.payment.findMany({
      where: { memberId: req.params.id },
      orderBy: { paidAt: 'desc' },
    });

    res.json({ data: payments });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
