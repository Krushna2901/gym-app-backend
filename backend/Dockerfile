# ── Backend Dockerfile ──────────────────────────────────────────────────────
FROM node:20-alpine

WORKDIR /app

# Install dependencies first (layer-cached unless package.json changes)
COPY package*.json ./
COPY prisma ./prisma/
RUN npm install

# Generate Prisma client
RUN npx prisma generate

# Copy rest of source (includes start.sh)
COPY . .

# Ensure start.sh is executable
RUN chmod +x start.sh

EXPOSE 5000

CMD ["sh", "start.sh"]
