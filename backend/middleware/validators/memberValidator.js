const { body, validationResult } = require('express-validator');

// Reusable middleware that checks for validation errors
const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
  next();
};

// ── Shared field rules ────────────────────────────────────────────────────────

const memberValidationRules = [
  body('fullName')
    .trim()
    .notEmpty().withMessage('Full name is required')
    .isLength({ min: 2, max: 100 }).withMessage('Name must be 2–100 characters')
    // NOTE: No .escape() — we store raw text.
    // React auto-escapes on render; using .escape() here corrupts names like O'Brien.
    .matches(/^[a-zA-Z\s.'\-]+$/).withMessage("Name can only contain letters, spaces, or . ' -"),

  body('mobile')
    .trim()
    .notEmpty().withMessage('Mobile number is required')
    .matches(/^[6-9]\d{9}$/).withMessage('Valid 10-digit Indian mobile number required (starting 6–9)'),

  body('email')
    .optional({ checkFalsy: true })
    .trim()
    .isEmail().withMessage('Must be a valid email format')
    .normalizeEmail(),

  body('address')
    .optional({ checkFalsy: true })
    .trim()
    // No .escape() — same reason as fullName
    .isLength({ max: 300 }).withMessage('Address must be under 300 characters'),

  body('membershipType')
    .optional()
    .isIn(['normal', 'athlete', 'other']).withMessage('Invalid membership type'),

  body('startDate')
    .notEmpty().withMessage('Start date is required')
    .isISO8601().withMessage('Valid start date required (YYYY-MM-DD)')
    .toDate(),

  body('endDate')
    .notEmpty().withMessage('End date is required')
    .isISO8601().withMessage('Valid end date required (YYYY-MM-DD)')
    .custom((value, { req }) => {
      if (new Date(value) <= new Date(req.body.startDate)) {
        throw new Error('End date must be after start date');
      }
      return true;
    })
    .toDate(),

  body('amountPaid')
    .optional()
    .isFloat({ min: 0 }).withMessage('Amount paid must be 0 or positive'),

  body('remainingAmount')
    .optional()
    .isFloat({ min: 0 }).withMessage('Remaining amount must be 0 or positive'),
];

// ── Create-only rules (adds initial payment fields) ───────────────────────────

const createMemberRules = [
  ...memberValidationRules,
  body('initialPaymentMethod')
    .optional()
    .isIn(['cash', 'upi', 'card']).withMessage('Invalid payment method'),
  body('transactionRef')
    .optional({ checkFalsy: true })
    .trim()
    .isLength({ max: 200 }).withMessage('Reference must be under 200 characters'),
];

// ── Renewal-only rules ────────────────────────────────────────────────────────

const renewValidationRules = [
  body('startDate')
    .notEmpty().withMessage('Start date is required')
    .isISO8601().withMessage('Valid start date required (YYYY-MM-DD)')
    .toDate(),

  body('endDate')
    .notEmpty().withMessage('End date is required')
    .isISO8601().withMessage('Valid end date required (YYYY-MM-DD)')
    .custom((value, { req }) => {
      if (new Date(value) <= new Date(req.body.startDate)) {
        throw new Error('End date must be after start date');
      }
      return true;
    })
    .toDate(),

  body('amountPaid')
    .optional()
    .isFloat({ min: 0 }).withMessage('Amount paid must be 0 or positive'),

  body('remainingAmount')
    .optional()
    .isFloat({ min: 0 }).withMessage('Remaining amount must be 0 or positive'),

  body('paymentMethod')
    .optional()
    .isIn(['cash', 'upi', 'card']).withMessage('Invalid payment method'),

  body('transactionRef')
    .optional({ checkFalsy: true })
    .trim()
    .isLength({ max: 200 }).withMessage('Reference must be under 200 characters'),
];

module.exports = { validate, memberValidationRules, createMemberRules, renewValidationRules };
