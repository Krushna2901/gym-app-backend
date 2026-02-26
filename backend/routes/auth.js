const express = require('express');
const bcrypt  = require('bcryptjs');
const jwt     = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');
const prisma  = require('../lib/prisma');

const router = express.Router();

// POST /api/auth/admin-login
router.post(
  '/admin-login',
  [
    body('email')
      .trim()
      .notEmpty().withMessage('Email required')
      .isEmail().withMessage('Valid email required')
      .normalizeEmail(),
    body('password')
      .trim()
      .notEmpty().withMessage('Password required'),
  ],
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { email, password } = req.body;

      const user = await prisma.user.findUnique({ where: { email } });

      // Always run bcrypt.compare to prevent timing-based user enumeration.
      // If user doesn't exist, compare against a dummy hash so response time
      // is identical whether the email exists or not.
      const DUMMY_HASH = '$2b$10$abcdefghijklmnopqrstuuABCDEFGHIJKLMNOPQRSTUVWXYZ012345';
      const hashToCompare = user ? user.passwordHash : DUMMY_HASH;
      const validPassword = await bcrypt.compare(password, hashToCompare);

      if (!user || !validPassword) {
        return res.status(401).json({ error: 'Invalid email or password' });
      }

      const token = jwt.sign(
        { id: user.id, email: user.email, role: user.role },
        process.env.JWT_SECRET,
        { expiresIn: '24h' }
      );

      res.json({
        token,
        user: { id: user.id, email: user.email, name: user.name, role: user.role },
      });
    } catch (err) {
      next(err);
    }
  }
);

module.exports = router;
