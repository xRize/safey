#!/bin/bash

# SmartTrust Database Setup Script
# This script creates the PostgreSQL database and user if they don't exist

set -e

DB_NAME="${DB_NAME:-smarttrust}"
DB_USER="${DB_USER:-smarttrust_user}"
DB_PASSWORD="${DB_PASSWORD:-smarttrust_pass}"
DB_HOST="${DB_HOST:-localhost}"
DB_PORT="${DB_PORT:-5432}"

echo "Setting up SmartTrust database..."

# Check if PostgreSQL is running
if ! pg_isready -h "$DB_HOST" -p "$DB_PORT" > /dev/null 2>&1; then
    echo "Error: PostgreSQL is not running on $DB_HOST:$DB_PORT"
    echo "Please start PostgreSQL or use Docker: docker-compose up -d db"
    exit 1
fi

# Create user if it doesn't exist
echo "Creating user '$DB_USER' if it doesn't exist..."
psql -h "$DB_HOST" -p "$DB_PORT" -U postgres -tc "SELECT 1 FROM pg_user WHERE usename = '$DB_USER'" | grep -q 1 || \
    psql -h "$DB_HOST" -p "$DB_PORT" -U postgres -c "CREATE USER $DB_USER WITH PASSWORD '$DB_PASSWORD';"

# Create database if it doesn't exist
echo "Creating database '$DB_NAME' if it doesn't exist..."
psql -h "$DB_HOST" -p "$DB_PORT" -U postgres -tc "SELECT 1 FROM pg_database WHERE datname = '$DB_NAME'" | grep -q 1 || \
    psql -h "$DB_HOST" -p "$DB_PORT" -U postgres -c "CREATE DATABASE $DB_NAME OWNER $DB_USER;"

# Grant privileges
echo "Granting privileges..."
psql -h "$DB_HOST" -p "$DB_PORT" -U postgres -c "GRANT ALL PRIVILEGES ON DATABASE $DB_NAME TO $DB_USER;"

echo "Database setup complete!"
echo ""
echo "Connection string: postgresql://$DB_USER:$DB_PASSWORD@$DB_HOST:$DB_PORT/$DB_NAME"

