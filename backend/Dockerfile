# ── Backend Dockerfile ──────────────────────────────────────────────────────
FROM node:20-alpine

WORKDIR /app

# Copy everything first
COPY . .

# Install dependencies
RUN npm install

# Generate Prisma client
RUN npx prisma generate

# Ensure start.sh is executable
RUN chmod +x start.sh

EXPOSE 5000

CMD ["sh", "start.sh"]
