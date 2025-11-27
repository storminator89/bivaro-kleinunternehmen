#!/bin/sh
# =============================================================================
# Docker Entrypoint Script
# Initializes database and starts the application
# =============================================================================

set -e

echo "🚀 Starting Buchhaltung..."

# Prisma CLI path
PRISMA_CLI="./node_modules/prisma/build/index.js"

# Debug: Show current user and permissions
echo "📋 Running as user: $(whoami) ($(id))"
echo "📋 Data directory permissions:"
ls -la /app/data/ 2>/dev/null || echo "   Directory does not exist or no permissions"

# Ensure data directory exists and is writable
if [ ! -d /app/data ]; then
    echo "📁 Creating data directory..."
    mkdir -p /app/data
fi

# Check write permissions
if [ ! -w /app/data ]; then
    echo "❌ ERROR: No write permissions on /app/data"
    echo "   Please ensure the volume is mounted with correct permissions"
    echo "   Try: docker compose down -v && docker compose up -d"
    exit 1
fi

# Check if database exists, if not initialize it
if [ ! -f /app/data/prod.db ]; then
    echo "📦 Initializing database..."
    
    # Run Prisma migrations to create the database
    if node $PRISMA_CLI migrate deploy --schema=/app/prisma/schema.prisma; then
        echo "✅ Database initialized successfully!"
    else
        echo "❌ Migration failed! Trying to create database with db push..."
        node $PRISMA_CLI db push --schema=/app/prisma/schema.prisma --accept-data-loss
        echo "✅ Database created with db push!"
    fi
else
    echo "📦 Database exists, checking for pending migrations..."
    
    # Apply any pending migrations
    if node $PRISMA_CLI migrate deploy --schema=/app/prisma/schema.prisma; then
        echo "✅ Migrations applied!"
    else
        echo "⚠️ Migration deploy failed, trying db push..."
        node $PRISMA_CLI db push --schema=/app/prisma/schema.prisma
        echo "✅ Schema synced with db push!"
    fi
fi

# Verify database exists
if [ -f /app/data/prod.db ]; then
    echo "✅ Database file exists: $(ls -la /app/data/prod.db)"
else
    echo "❌ ERROR: Database file was not created!"
    exit 1
fi

echo "🌐 Starting server..."

# Start the application
exec node server.js
