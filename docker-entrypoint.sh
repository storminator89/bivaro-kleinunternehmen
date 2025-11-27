#!/bin/sh
# =============================================================================
# Docker Entrypoint Script
# Initializes database and starts the application
# =============================================================================

set -e

echo "🚀 Starting Buchhaltung..."

# Prisma CLI path
PRISMA_CLI="./node_modules/prisma/build/index.js"

# Check if database exists, if not initialize it
if [ ! -f /app/data/prod.db ]; then
    echo "📦 Initializing database..."
    
    # Create data directory if it doesn't exist
    mkdir -p /app/data
    
    # Run Prisma migrations to create the database
    node $PRISMA_CLI migrate deploy --schema=/app/prisma/schema.prisma
    
    echo "✅ Database initialized successfully!"
else
    echo "📦 Database exists, checking for pending migrations..."
    
    # Apply any pending migrations
    node $PRISMA_CLI migrate deploy --schema=/app/prisma/schema.prisma
    
    echo "✅ Migrations applied!"
fi

echo "🌐 Starting server..."

# Start the application
exec node server.js
