# syntax=docker/dockerfile:1

# =============================================================================
# BUCHHALTUNG - Production Docker Image
# State-of-the-art Multi-Stage Build with Security Best Practices
# =============================================================================

# -----------------------------------------------------------------------------
# Stage 1: Base - Common configuration
# -----------------------------------------------------------------------------
FROM node:25-slim AS base

# Install security updates and required packages
RUN apt-get update && apt-get upgrade -y && \
    apt-get install -y --no-install-recommends openssl dumb-init ca-certificates && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Disable telemetry
ENV NEXT_TELEMETRY_DISABLED=1

# -----------------------------------------------------------------------------
# Stage 2: Dependencies - Install ALL dependencies for build
# -----------------------------------------------------------------------------
FROM base AS deps

# Set DATABASE_URL for Prisma generate (will be overridden at runtime)
ENV DATABASE_URL="file:/app/data/prod.db"

# Copy package files
COPY package.json package-lock.json* ./
COPY prisma ./prisma/

# Install ALL dependencies (including devDependencies for build)
RUN npm ci && \
    npx prisma generate && \
    npm cache clean --force

# -----------------------------------------------------------------------------
# Stage 3: Builder - Build the application
# -----------------------------------------------------------------------------
FROM base AS builder

WORKDIR /app

# Set DATABASE_URL for Prisma (will be overridden at runtime)
ENV DATABASE_URL="file:/app/data/prod.db"

# Copy all dependencies from deps stage (including devDependencies)
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/prisma ./prisma

# Copy source code
COPY . .

# Build the application
RUN npm run build

# Prune devDependencies after build for smaller final image
RUN npm prune --omit=dev && \
    npx prisma generate

# -----------------------------------------------------------------------------
# Stage 4: Runner - Production runtime
# -----------------------------------------------------------------------------
FROM node:25-slim AS runner

# Install security updates and dumb-init for proper signal handling
RUN apt-get update && apt-get upgrade -y && \
    apt-get install -y --no-install-recommends openssl dumb-init curl ca-certificates && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Environment configuration
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME="0.0.0.0"

# Create non-root user for security
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

# Create necessary directories with correct permissions
RUN mkdir -p /app/data /app/public/uploads /app/prisma && \
    chown -R nextjs:nodejs /app && \
    chmod 755 /app/data /app/public/uploads

# Copy built application from builder
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/prisma ./prisma
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# Copy Prisma binaries and CLI (needed for migrations at runtime)
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/prisma ./node_modules/prisma

# Copy package.json for npx to work correctly
COPY --from=builder --chown=nextjs:nodejs /app/package.json ./package.json

# Copy entrypoint script
COPY --chown=nextjs:nodejs docker-entrypoint.sh ./

# Switch to non-root user
USER nextjs

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD curl -f http://localhost:3000/api/health || exit 1

# Use dumb-init to handle signals properly (PID 1 problem)
ENTRYPOINT ["dumb-init", "--"]

# Start the application with entrypoint script
CMD ["sh", "docker-entrypoint.sh"]
