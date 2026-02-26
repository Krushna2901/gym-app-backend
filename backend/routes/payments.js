const express = require('express');
const { body, validationResult } = require('express-validator');
const authenticate = require('../middleware/authenticate');
const { sendPaymentReceipt } = require('../utils/whatsapp');
const prisma = require('../lib/prisma');

const router = express.Router();

router.use(authenticate);

// ── POST /api/payments — Record a payment ─────────────────────────────────────
router.post(
  '/',
  [
    body('memberId').isUUID().withMessage('Valid member ID required'),
    body('amount').isFloat({ gt: 0 }).withMessage('Amount must be a positive number'),
    body('paymentMethod').isIn(['cash', 'upi', 'card']).withMessage('Invalid payment method'),
    body('transactionRef')
      .optional({ checkFalsy: true })
      .trim()
      .isLength({ max: 200 }).withMessage('Reference must be under 200 characters'),
  ],
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

      const { memberId, amount, paymentMethod, transactionRef } = req.body;

      const member = await prisma.member.findFirst({
        where: { id: memberId, isDeleted: false },
      });
      if (!member) return res.status(404).json({ error: 'Member not found' });

      // Create payment and update member balance atomically
      const [payment, updatedMember] = await prisma.$transaction(async (tx) => {
        const p = await tx.payment.create({
          data: {
            memberId,
            amount:        parseFloat(amount),
            paymentMethod,
            transactionRef: transactionRef || null,
          },
        });

        const newAmountPaid = parseFloat(member.amountPaid) + parseFloat(amount);
        const newRemaining  = Math.max(0, parseFloat(member.remainingAmount) - parseFloat(amount));
        const paymentStatus = newRemaining <= 0 ? 'paid' : 'partial';

        const m = await tx.member.update({
          where: { id: memberId },
          data: { amountPaid: newAmountPaid, remainingAmount: newRemaining, paymentStatus },
        });

        return [p, m];
      });

      // Fire-and-forget WhatsApp mock notification (never blocks response)
      sendPaymentReceipt(member.mobile, member.fullName, amount).catch(console.error);

      res.status(201).json({ data: payment, member: updatedMember });
    } catch (err) {
      next(err);
    }
  }
);

// ── GET /api/payments/summary — Revenue overview ──────────────────────────────
// MUST be before /member/:id to avoid route conflict
router.get('/summary', async (req, res, next) => {
  try {
    const now              = new Date();
    const startOfMonth     = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);

    const [totalRevenue, monthlyRevenue, lastMonthRevenue, recentPayments] = await Promise.all([
      prisma.payment.aggregate({ _sum: { amount: true } }),
      prisma.payment.aggregate({ _sum: { amount: true }, where: { paidAt: { gte: startOfMonth } } }),
      prisma.payment.aggregate({ _sum: { amount: true }, where: { paidAt: { gte: startOfLastMonth, lt: startOfMonth } } }),
      prisma.payment.findMany({
        take: 10,
        orderBy: { paidAt: 'desc' },
        include: { member: { select: { fullName: true, mobile: true } } },
      }),
    ]);

    res.json({
      data: {
        totalRevenue:     totalRevenue._sum.amount     || 0,
        monthlyRevenue:   monthlyRevenue._sum.amount   || 0,
        lastMonthRevenue: lastMonthRevenue._sum.amount || 0,
        recentPayments,
      },
    });
  } catch (err) {
    next(err);
  }
});

// ── GET /api/payments/member/:id — Payment history for a member ───────────────
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
