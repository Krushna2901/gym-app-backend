const express   = require('express');
const { validate, memberValidationRules, createMemberRules, renewValidationRules } = require('../middleware/validators/memberValidator');
const authenticate = require('../middleware/authenticate');
const prisma    = require('../lib/prisma');

const router = express.Router();

// All member routes require authentication
router.use(authenticate);

// ── Helper ────────────────────────────────────────────────────────────────────
// Single source of truth for paymentStatus derivation.
function derivePaymentStatus(paid, remaining) {
  if (paid > 0 && remaining <= 0) return 'paid';
  if (paid > 0 && remaining > 0)  return 'partial';
  return 'pending';
}

// ── GET /api/members/expiring ─────────────────────────────────────────────────
// MUST be before /:id to avoid route conflict
router.get('/expiring', async (req, res, next) => {
  try {
    const days = Math.min(Math.max(1, parseInt(req.query.days) || 30), 90);
    const now  = new Date();
    const until = new Date();
    until.setDate(until.getDate() + days);

    const members = await prisma.member.findMany({
      where: { isDeleted: false, endDate: { gte: now, lte: until } },
      orderBy: { endDate: 'asc' },
    });

    res.json({ data: members });
  } catch (err) {
    next(err);
  }
});

// ── GET /api/members ──────────────────────────────────────────────────────────
router.get('/', async (req, res, next) => {
  try {
    const page  = Math.max(1, parseInt(req.query.page) || 1);
    // Cap limit at 5000 — enough for any gym's full export, prevents runaway queries
    const limit = Math.min(Math.max(1, parseInt(req.query.limit) || 20), 5000);
    const skip  = (page - 1) * limit;
    const search = (req.query.search || '').trim();
    const status = req.query.status;
    const type   = req.query.type;

    const where = {
      isDeleted: false,
      ...(search && {
        OR: [
          { fullName: { contains: search, mode: 'insensitive' } },
          { mobile:   { contains: search } },
          { email:    { contains: search, mode: 'insensitive' } },
        ],
      }),
      ...(status && { paymentStatus: status }),
      ...(type   && { membershipType: type }),
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
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    });
  } catch (err) {
    next(err);
  }
});

// ── GET /api/members/:id ──────────────────────────────────────────────────────
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

// ── POST /api/members — Create ────────────────────────────────────────────────
router.post('/', createMemberRules, validate, async (req, res, next) => {
  try {
    const {
      fullName, mobile, email, address,
      membershipType, startDate, endDate,
      amountPaid, remainingAmount, branchId,
      initialPaymentMethod, transactionRef,
    } = req.body;

    const paid      = parseFloat(amountPaid)      || 0;
    const remaining = parseFloat(remainingAmount) || 0;

    // Create member + initial payment in a single atomic transaction
    const member = await prisma.$transaction(async (tx) => {
      const m = await tx.member.create({
        data: {
          fullName,
          mobile,
          email:          email   || null,
          address:        address || null,
          membershipType: membershipType || 'normal',
          startDate:      new Date(startDate),
          endDate:        new Date(endDate),
          paymentStatus:  derivePaymentStatus(paid, remaining),
          amountPaid:     paid,
          remainingAmount: remaining,
          branchId:       branchId || null,
        },
      });

      if (paid > 0) {
        await tx.payment.create({
          data: {
            memberId:      m.id,
            amount:        paid,
            paymentMethod: initialPaymentMethod || 'cash',
            transactionRef: transactionRef || null,
          },
        });
      }

      return m;
    });

    res.status(201).json({ data: member });
  } catch (err) {
    if (err.code === 'P2002') {
      return res.status(409).json({ error: 'A member with this mobile number already exists' });
    }
    next(err);
  }
});

// ── PUT /api/members/:id — Update ────────────────────────────────────────────
// Only whitelisted fields are applied — prevents overwriting isDeleted,
// createdAt, or any internal flags via req.body spread.
router.put('/:id', memberValidationRules, validate, async (req, res, next) => {
  try {
    const existing = await prisma.member.findFirst({
      where: { id: req.params.id, isDeleted: false },
    });
    if (!existing) return res.status(404).json({ error: 'Member not found' });

    // Explicitly destructure only the fields we allow updating
    const { fullName, mobile, email, address, membershipType, startDate, endDate, amountPaid, remainingAmount } = req.body;

    const paid      = amountPaid      !== undefined ? parseFloat(amountPaid)      : parseFloat(existing.amountPaid);
    const remaining = remainingAmount !== undefined ? parseFloat(remainingAmount) : parseFloat(existing.remainingAmount);

    const member = await prisma.member.update({
      where: { id: req.params.id, isDeleted: false },
      data: {
        fullName,
        mobile,
        email:           email   || null,
        address:         address || null,
        membershipType:  membershipType || existing.membershipType,
        startDate:       startDate ? new Date(startDate) : existing.startDate,
        endDate:         endDate   ? new Date(endDate)   : existing.endDate,
        amountPaid:      paid,
        remainingAmount: remaining,
        // Always recalculate — client cannot manually set paymentStatus
        paymentStatus:   derivePaymentStatus(paid, remaining),
      },
    });

    res.json({ data: member });
  } catch (err) {
    if (err.code === 'P2002') {
      return res.status(409).json({ error: 'A member with this mobile number already exists' });
    }
    next(err);
  }
});

// ── DELETE /api/members/:id — Soft delete ────────────────────────────────────
router.delete('/:id', async (req, res, next) => {
  try {
    const existing = await prisma.member.findFirst({
      where: { id: req.params.id, isDeleted: false },
    });
    if (!existing) return res.status(404).json({ error: 'Member not found' });

    await prisma.member.update({
      where: { id: req.params.id, isDeleted: false },
      data: { isDeleted: true },
    });

    res.json({ message: 'Member deleted successfully' });
  } catch (err) {
    next(err);
  }
});

// ── POST /api/members/:id/renew ───────────────────────────────────────────────
router.post('/:id/renew', renewValidationRules, validate, async (req, res, next) => {
  try {
    const { startDate, endDate, amountPaid, remainingAmount, paymentMethod, transactionRef } = req.body;

    const existing = await prisma.member.findFirst({
      where: { id: req.params.id, isDeleted: false },
    });
    if (!existing) return res.status(404).json({ error: 'Member not found' });

    const paid      = parseFloat(amountPaid)      || 0;
    const remaining = parseFloat(remainingAmount) || 0;

    const member = await prisma.$transaction(async (tx) => {
      const m = await tx.member.update({
        where: { id: req.params.id },
        data: {
          startDate:       new Date(startDate),
          endDate:         new Date(endDate),
          amountPaid:      paid,
          remainingAmount: remaining,
          paymentStatus:   derivePaymentStatus(paid, remaining),
        },
      });

      if (paid > 0) {
        await tx.payment.create({
          data: {
            memberId:      req.params.id,
            amount:        paid,
            paymentMethod: paymentMethod || 'cash',
            transactionRef: transactionRef || null,
          },
        });
      }

      return m;
    });

    res.json({ data: member });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
