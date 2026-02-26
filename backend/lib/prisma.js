const { PrismaClient } = require('@prisma/client');

// Singleton pattern — prevents multiple connection pools during dev hot-reload
// and ensures a single pool in production for efficient DB connections.
let prisma;

if (process.env.NODE_ENV === 'production') {
  prisma = new PrismaClient();
} else {
  if (!global.__prisma) {
    global.__prisma = new PrismaClient();
  }
  prisma = global.__prisma;
}

module.exports = prisma;
