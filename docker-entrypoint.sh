#!/bin/sh
# =============================================================================
# Docker Entrypoint Script
# Initializes database and starts the application
# =============================================================================

set -e

echo "🚀 Starting Buchhaltung..."

# Check if database exists, if not initialize it
if [ ! -f /app/data/prod.db ]; then
    echo "📦 Initializing database..."
    
    # Create data directory if it doesn't exist
    mkdir -p /app/data
    
    # Run Prisma migrations to create the database
    npx prisma migrate deploy --schema=/app/prisma/schema.prisma
    
    echo "✅ Database initialized successfully!"
else
    echo "📦 Database exists, checking for pending migrations..."
    
    # Apply any pending migrations
    npx prisma migrate deploy --schema=/app/prisma/schema.prisma
    
    echo "✅ Migrations applied!"
fi

echo "🌐 Starting server..."

# Start the application
exec node server.js
