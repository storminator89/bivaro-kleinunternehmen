# syntax=docker/dockerfile:1

# =============================================================================
# BUCHHALTUNG - Production Docker Image
# State-of-the-art Multi-Stage Build with Security Best Practices
# =============================================================================

# -----------------------------------------------------------------------------
# Stage 1: Base - Common configuration
# -----------------------------------------------------------------------------
FROM node:22-alpine AS base

# Install security updates and required packages
RUN apk update && apk upgrade --no-cache && \
    apk add --no-cache libc6-compat openssl dumb-init

WORKDIR /app

# Disable telemetry
ENV NEXT_TELEMETRY_DISABLED=1

# -----------------------------------------------------------------------------
# Stage 2: Dependencies - Install ALL dependencies for build
# -----------------------------------------------------------------------------
FROM base AS deps

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
FROM node:22-alpine AS runner

# Install security updates and dumb-init for proper signal handling
RUN apk update && apk upgrade --no-cache && \
    apk add --no-cache libc6-compat openssl dumb-init curl && \
    rm -rf /var/cache/apk/*

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
    chown -R nextjs:nodejs /app

# Copy built application from builder
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/prisma ./prisma
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# Copy node_modules for Prisma CLI (needed for migrations)
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/prisma ./node_modules/prisma

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
