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

# Erstelle Symlink: Prisma sucht in ./dev.db relativ zum Schema
# Wir linken /app/prisma/dev.db -> /app/data/prod.db
echo "🔗 Setting up database symlink..."
rm -f /app/prisma/dev.db 2>/dev/null || true
ln -sf /app/data/prod.db /app/prisma/dev.db
echo "   /app/prisma/dev.db -> /app/data/prod.db"

# Setze DATABASE_URL für Prisma CLI (relativ zum prisma-Verzeichnis)
export DATABASE_URL="file:./dev.db"
echo "📋 DATABASE_URL: $DATABASE_URL"

# Check if database exists, if not initialize it
if [ ! -f /app/data/prod.db ]; then
    echo "📦 Initializing database..."
    
    # Erstelle leere Datei damit der Symlink funktioniert
    touch /app/data/prod.db
    
    # Run Prisma migrations to create the database
    cd /app/prisma
    if node /app/$PRISMA_CLI migrate deploy --schema=/app/prisma/schema.prisma; then
        echo "✅ Database initialized successfully!"
    else
        echo "❌ Migration failed! Trying to create database with db push..."
        node /app/$PRISMA_CLI db push --schema=/app/prisma/schema.prisma --accept-data-loss
        echo "✅ Database created with db push!"
    fi
    cd /app
else
    echo "📦 Database exists, checking for pending migrations..."
    
    # Apply any pending migrations
    cd /app/prisma
    if node /app/$PRISMA_CLI migrate deploy --schema=/app/prisma/schema.prisma; then
        echo "✅ Migrations applied!"
    else
        echo "⚠️ Migration deploy failed, trying db push..."
        node /app/$PRISMA_CLI db push --schema=/app/prisma/schema.prisma
        echo "✅ Schema synced with db push!"
    fi
    cd /app
fi

# Verify database exists
if [ -f /app/data/prod.db ]; then
    DB_SIZE=$(ls -la /app/data/prod.db | awk '{print $5}')
    echo "✅ Database file exists: /app/data/prod.db (${DB_SIZE} bytes)"
else
    echo "❌ ERROR: Database file was not created!"
    exit 1
fi

echo "🌐 Starting server..."

# Start the application
exec node server.js
