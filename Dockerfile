# syntax=docker/dockerfile:1

# =============================================================================
# BUCHHALTUNG - Production Docker Image
# State-of-the-art Multi-Stage Build with Security Best Practices
# =============================================================================

# -----------------------------------------------------------------------------
# Stage 1: Base - Common configuration
# -----------------------------------------------------------------------------
FROM node:22-slim AS base

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
FROM node:22-slim AS runner

# Install security updates and dumb-init for proper signal handling
RUN apt-get update && apt-get upgrade -y && \
    apt-get install -y --no-install-recommends openssl dumb-init curl ca-certificates ghostscript && \
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
# The Prisma CLI is executed by docker-entrypoint.sh at runtime. Its package
# dependencies are not included by Next standalone tracing, so copy the
# runtime closure explicitly as well.
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/effect ./node_modules/effect
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/empathic ./node_modules/empathic
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/fast-check ./node_modules/fast-check
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/pure-rand ./node_modules/pure-rand
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/deepmerge-ts ./node_modules/deepmerge-ts
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/c12 ./node_modules/c12
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/chokidar ./node_modules/chokidar
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/readdirp ./node_modules/readdirp
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/confbox ./node_modules/confbox
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/defu ./node_modules/defu
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/dotenv ./node_modules/dotenv
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/exsolve ./node_modules/exsolve
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/giget ./node_modules/giget
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/citty ./node_modules/citty
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/consola ./node_modules/consola
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/node-fetch-native ./node_modules/node-fetch-native
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/nypm ./node_modules/nypm
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/pathe ./node_modules/pathe
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/tinyexec ./node_modules/tinyexec
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/jiti ./node_modules/jiti
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/ohash ./node_modules/ohash
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/perfect-debounce ./node_modules/perfect-debounce
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/pkg-types ./node_modules/pkg-types
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/rc9 ./node_modules/rc9
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/destr ./node_modules/destr

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
