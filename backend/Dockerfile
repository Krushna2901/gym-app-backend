# ── Backend Dockerfile ──────────────────────────────────────────────────────
FROM node:20-alpine

WORKDIR /app

# Install dependencies first (layer-cached unless package.json changes)
COPY package*.json ./
COPY prisma ./prisma/
RUN npm ci

# Generate Prisma client
RUN npx prisma generate

# Copy rest of source
COPY . .

EXPOSE 5000

# start.sh: migrate → seed → serve
COPY start.sh ./
RUN chmod +x start.sh

CMD ["sh", "start.sh"]
