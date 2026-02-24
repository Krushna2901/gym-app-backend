#!/bin/sh
set -e

echo "🔄  Running database migrations..."
npx prisma migrate deploy

echo "🌱  Seeding database..."
node prisma/seed.js

echo "🚀  Starting backend server..."
exec node server.js
