const express = require('express');
const cors    = require('cors');
const dotenv  = require('dotenv');

dotenv.config();

// ── Fail fast on missing critical env vars ────────────────────────────────────
if (!process.env.JWT_SECRET) {
  console.error('FATAL: JWT_SECRET environment variable is not set. Refusing to start.');
  process.exit(1);
}

const authRoutes    = require('./routes/auth');
const memberRoutes  = require('./routes/members');
const paymentRoutes = require('./routes/payments');

const app = express();

// ── CORS ──────────────────────────────────────────────────────────────────────
// FRONTEND_URL can be a comma-separated list or "*" to allow all origins.
const rawOrigins    = (process.env.FRONTEND_URL || 'http://localhost:5173').split(',').map(s => s.trim());
const allowAllOrigins = rawOrigins.includes('*');

app.use(cors({
  origin: (origin, cb) => {
    // Allow server-to-server requests (no origin), wildcard, or explicit list
    if (!origin || allowAllOrigins || rawOrigins.includes(origin)) return cb(null, true);
    cb(new Error(`CORS: ${origin} not allowed`));
  },
  credentials: true,
}));

// ── Body parser with size guard (prevents large-payload DoS) ─────────────────
app.use(express.json({ limit: '1mb' }));

// ── Health check ─────────────────────────────────────────────────────────────
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ── Routes ───────────────────────────────────────────────────────────────────
app.use('/api/auth',     authRoutes);
app.use('/api/members',  memberRoutes);
app.use('/api/payments', paymentRoutes);

// ── Global error handler ─────────────────────────────────────────────────────
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  console.error(err.stack);
  res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
