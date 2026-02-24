const express = require('express');
const { PrismaClient } = require('@prisma/client');
const { body, validationResult } = require('express-validator');
const authenticate = require('../middleware/authenticate');

const router = express.Router();
const prisma = new PrismaClient();

// All member routes require authentication
router.use(authenticate);

// GET /api/members/expiring - Members expiring within N days
// MUST be before /:id to avoid route conflict
router.get('/expiring', async (req, res, next) => {
  try {
    const days = parseInt(req.query.days) || 30;
    const now = new Date();
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + days);

    const members = await prisma.member.findMany({
      where: {
        isDeleted: false,
        endDate: { gte: now, lte: futureDate },
      },
      orderBy: { endDate: 'asc' },
    });

    res.json({ data: members });
  } catch (err) {
    next(err);
  }
});

// GET /api/members - List with search, filter, pagination
router.get('/', async (req, res, next) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;
    const search = req.query.search || '';
    const status = req.query.status;
    const type = req.query.type;

    const where = {
      isDeleted: false,
      ...(search && {
        OR: [
          { fullName: { contains: search, mode: 'insensitive' } },
          { mobile: { contains: search } },
          { email: { contains: search, mode: 'insensitive' } },
        ],
      }),
      ...(status && { paymentStatus: status }),
      ...(type && { membershipType: type }),
    };

    const [members, total] = await Promise.all([
      prisma.member.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: { branch: true },
      }),
      prisma.member.count({ where }),
    ]);

    res.json({
      data: members,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/members/:id - Single member with payments
router.get('/:id', async (req, res, next) => {
  try {
    const member = await prisma.member.findFirst({
      where: { id: req.params.id, isDeleted: false },
      include: { payments: { orderBy: { paidAt: 'desc' } }, branch: true },
    });

    if (!member) return res.status(404).json({ error: 'Member not found' });
    res.json({ data: member });
  } catch (err) {
    next(err);
  }
});

// POST /api/members - Create member
router.post(
  '/',
  [
    body('fullName').trim().notEmpty().withMessage('Full name is required'),
    body('mobile').trim().notEmpty().withMessage('Mobile number is required'),
    body('startDate').isISO8601().withMessage('Valid start date required'),
    body('endDate').isISO8601().withMessage('Valid end date required'),
    body('membershipType').optional().isIn(['normal', 'athlete', 'other']),
    body('initialPaymentMethod').optional().isIn(['cash', 'upi', 'card']),
  ],
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const {
        fullName, mobile, email, address,
        membershipType, startDate, endDate,
        amountPaid, remainingAmount, branchId,
        initialPaymentMethod, transactionRef,
      } = req.body;

      let paymentStatus = 'pending';
      const paid = parseFloat(amountPaid) || 0;
      const remaining = parseFloat(remainingAmount) || 0;
      if (paid > 0 && remaining > 0) paymentStatus = 'partial';
      if (paid > 0 && remaining <= 0) paymentStatus = 'paid';

      // Create member + initial payment atomically so revenue is always accurate
      const member = await prisma.$transaction(async (tx) => {
        const member = await tx.member.create({
          data: {
            fullName,
            mobile,
            email: email || null,
            address: address || null,
            membershipType: membershipType || 'normal',
            startDate: new Date(startDate),
            endDate: new Date(endDate),
            paymentStatus,
            amountPaid: paid,
            remainingAmount: remaining,
            branchId: branchId || null,
          },
        });

        // Record initial payment so it appears in revenue dashboard
        if (paid > 0) {
          await tx.payment.create({
            data: {
              memberId: member.id,
              amount: paid,
              paymentMethod: initialPaymentMethod || 'cash',
              transactionRef: transactionRef || null,
            },
          });
        }

        return member;
      });

      res.status(201).json({ data: member });
    } catch (err) {
      if (err.code === 'P2002') {
        return res.status(409).json({ error: 'A member with this mobile number already exists' });
      }
      next(err);
    }
  }
);

// PUT /api/members/:id - Update member
router.put('/:id', async (req, res, next) => {
  try {
    const existing = await prisma.member.findFirst({
      where: { id: req.params.id, isDeleted: false },
    });
    if (!existing) return res.status(404).json({ error: 'Member not found' });

    const updateData = { ...req.body };
    if (updateData.startDate) updateData.startDate = new Date(updateData.startDate);
    if (updateData.endDate) updateData.endDate = new Date(updateData.endDate);
    if (updateData.amountPaid !== undefined) updateData.amountPaid = parseFloat(updateData.amountPaid);
    if (updateData.remainingAmount !== undefined) updateData.remainingAmount = parseFloat(updateData.remainingAmount);

    // Remove fields that shouldn't be directly updated
    delete updateData.id;
    delete updateData.createdAt;
    delete updateData.updatedAt;
    delete updateData.payments;
    delete updateData.branch;

    const member = await prisma.member.update({
      where: { id: req.params.id },
      data: updateData,
    });

    res.json({ data: member });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/members/:id - Soft delete
router.delete('/:id', async (req, res, next) => {
  try {
    const existing = await prisma.member.findFirst({
      where: { id: req.params.id, isDeleted: false },
    });
    if (!existing) return res.status(404).json({ error: 'Member not found' });

    await prisma.member.update({
      where: { id: req.params.id },
      data: { isDeleted: true },
    });

    res.json({ message: 'Member deleted successfully' });
  } catch (err) {
    next(err);
  }
});

// POST /api/members/:id/renew - Renew membership
router.post('/:id/renew', async (req, res, next) => {
  try {
    const { startDate, endDate, amountPaid, remainingAmount, paymentMethod, transactionRef } = req.body;

    const existing = await prisma.member.findFirst({
      where: { id: req.params.id, isDeleted: false },
    });
    if (!existing) return res.status(404).json({ error: 'Member not found' });

    const paid = parseFloat(amountPaid) || 0;
    const remaining = parseFloat(remainingAmount) || 0;
    let paymentStatus = 'pending';
    if (paid > 0 && remaining > 0) paymentStatus = 'partial';
    if (paid > 0 && remaining <= 0) paymentStatus = 'paid';

    const member = await prisma.$transaction(async (tx) => {
      const member = await tx.member.update({
        where: { id: req.params.id },
        data: {
          startDate: new Date(startDate),
          endDate: new Date(endDate),
          amountPaid: paid,
          remainingAmount: remaining,
          paymentStatus,
        },
      });

      // Record renewal payment so it appears in revenue
      if (paid > 0) {
        await tx.payment.create({
          data: {
            memberId: req.params.id,
            amount: paid,
            paymentMethod: paymentMethod || 'cash',
            transactionRef: transactionRef || null,
          },
        });
      }

      return member;
    });

    res.json({ data: member });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
