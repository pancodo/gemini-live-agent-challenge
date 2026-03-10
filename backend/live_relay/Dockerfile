FROM node:20-slim

WORKDIR /app

# Install pnpm globally
RUN npm install -g pnpm

# Copy package files
COPY package.json pnpm-lock.yaml* ./

# Install production dependencies only
RUN pnpm install --prod

# Copy application source
COPY src/ ./src/

# Create non-root user for security
RUN useradd -m -u 1000 nodeuser && chown -R nodeuser:nodeuser /app
USER nodeuser

# Set environment variables
ENV NODE_ENV=production

# Expose Cloud Run port
EXPOSE 8080

# Start the relay server
CMD ["node", "src/index.js"]
