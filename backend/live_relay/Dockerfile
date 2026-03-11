FROM node:20-slim AS base

WORKDIR /app

# Install dependencies
COPY package.json pnpm-lock.yaml* ./
RUN corepack enable && corepack prepare pnpm@latest --activate \
    && pnpm install --frozen-lockfile --prod 2>/dev/null \
    || pnpm install --prod

# Copy application code
COPY . .

# Cloud Run sets PORT automatically
ENV PORT=8080
EXPOSE 8080

# Run as non-root
USER node

CMD ["node", "server.js"]
