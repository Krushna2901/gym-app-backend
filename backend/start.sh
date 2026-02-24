#!/bin/sh
set -e

echo "⏳  Waiting for database to be ready..."
# Give Postgres a moment if it just started (compose healthcheck handles this,
# but a small retry loop adds extra safety)
until npx prisma db execute --stdin <<'SQL' 2>/dev/null
SELECT 1;
SQL
do
  echo "   ...retrying in 2 s"
  sleep 2
done

echo "🔄  Running database migrations..."
npx prisma migrate deploy

echo "🌱  Seeding database (idempotent)..."
node prisma/seed.js

echo "🚀  Starting backend server..."
exec node server.js
