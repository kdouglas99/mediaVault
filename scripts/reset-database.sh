#!/bin/bash

# Database Reset Script for Media Vault
# This script drops and recreates the database with the schema

set -e  # Exit on any error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check if .env file exists
if [ ! -f ".env" ]; then
    print_error ".env file not found!"
    print_status "Please copy env.example to .env and configure your database settings:"
    echo "  cp env.example .env"
    echo "  # Edit .env with your database credentials"
    exit 1
fi

# Load environment variables
export $(grep -v '^#' .env | xargs)

# Check required environment variables
required_vars=("DB_HOST" "DB_PORT" "DB_NAME" "DB_USER" "DB_PASSWORD")
for var in "${required_vars[@]}"; do
    if [ -z "${!var}" ]; then
        print_error "Required environment variable $var is not set in .env file"
        exit 1
    fi
done

print_status "Resetting database: $DB_NAME on $DB_HOST:$DB_PORT"

# Check if PostgreSQL is running
print_status "Checking PostgreSQL connection..."
if ! pg_isready -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" >/dev/null 2>&1; then
    print_error "Cannot connect to PostgreSQL server at $DB_HOST:$DB_PORT"
    print_status "Please ensure PostgreSQL is running and accessible"
    exit 1
fi

print_success "PostgreSQL server is accessible"

# Drop database if it exists
print_status "Dropping database '$DB_NAME' if it exists..."
dropdb -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" "$DB_NAME" 2>/dev/null || {
    if [ $? -eq 1 ]; then
        print_warning "Database '$DB_NAME' does not exist or could not be dropped"
    else
        print_error "Failed to drop database '$DB_NAME'"
        exit 1
    fi
}

# Create database
print_status "Creating database '$DB_NAME'..."
createdb -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" "$DB_NAME"
print_success "Database '$DB_NAME' created successfully"

# Run schema
print_status "Applying database schema..."
if [ -f "server/schema.sql" ]; then
    psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -f "server/schema.sql"
    print_success "Database schema applied successfully"
else
    print_error "Schema file server/schema.sql not found"
    exit 1
fi

# Verify tables were created
print_status "Verifying database setup..."
table_count=$(psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -t -c "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public';" | tr -d ' ')

if [ "$table_count" -ge 2 ]; then
    print_success "Database reset completed successfully!"
    print_status "Created $table_count tables in database '$DB_NAME'"
    
    # Show created tables
    print_status "Created tables:"
    psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -c "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name;" -t | sed 's/^/  - /'
    
else
    print_error "Database setup verification failed. Expected at least 2 tables, found $table_count"
    exit 1
fi

print_success "🎉 Database reset complete! You can now start the application."
print_status "Next steps:"
echo "  1. Start the backend: cd server && npm start"
echo "  2. Start the frontend: npm run dev"
echo "  3. Or use Docker: docker-compose up -d"
