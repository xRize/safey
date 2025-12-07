# SmartTrust Database Setup Script (PowerShell)
# This script creates the PostgreSQL database and user if they don't exist

$ErrorActionPreference = "Stop"

$DB_NAME = if ($env:DB_NAME) { $env:DB_NAME } else { "smarttrust" }
$DB_USER = if ($env:DB_USER) { $env:DB_USER } else { "smarttrust_user" }
$DB_PASSWORD = if ($env:DB_PASSWORD) { $env:DB_PASSWORD } else { "smarttrust_pass" }
$DB_HOST = if ($env:DB_HOST) { $env:DB_HOST } else { "localhost" }
$DB_PORT = if ($env:DB_PORT) { $env:DB_PORT } else { "5432" }

Write-Host "Setting up SmartTrust database..." -ForegroundColor Cyan

# Check if PostgreSQL is running
try {
    $pgTest = & pg_isready -h $DB_HOST -p $DB_PORT 2>&1
    if ($LASTEXITCODE -ne 0) {
        throw "PostgreSQL not running"
    }
} catch {
    Write-Host "Error: PostgreSQL is not running on ${DB_HOST}:${DB_PORT}" -ForegroundColor Red
    Write-Host "Please start PostgreSQL or use Docker: docker-compose up -d db" -ForegroundColor Yellow
    exit 1
}

# Create user if it doesn't exist
Write-Host "Creating user '$DB_USER' if it doesn't exist..." -ForegroundColor Yellow
$userExists = psql -h $DB_HOST -p $DB_PORT -U postgres -tc "SELECT 1 FROM pg_user WHERE usename = '$DB_USER'" 2>&1
if (-not $userExists -or $userExists -notmatch "1") {
    $env:PGPASSWORD = "postgres"  # Default postgres password, adjust if needed
    psql -h $DB_HOST -p $DB_PORT -U postgres -c "CREATE USER $DB_USER WITH PASSWORD '$DB_PASSWORD';" 2>&1 | Out-Null
}

# Create database if it doesn't exist
Write-Host "Creating database '$DB_NAME' if it doesn't exist..." -ForegroundColor Yellow
$dbExists = psql -h $DB_HOST -p $DB_PORT -U postgres -tc "SELECT 1 FROM pg_database WHERE datname = '$DB_NAME'" 2>&1
if (-not $dbExists -or $dbExists -notmatch "1") {
    $env:PGPASSWORD = "postgres"
    psql -h $DB_HOST -p $DB_PORT -U postgres -c "CREATE DATABASE $DB_NAME OWNER $DB_USER;" 2>&1 | Out-Null
}

# Grant privileges
Write-Host "Granting privileges..." -ForegroundColor Yellow
$env:PGPASSWORD = "postgres"
psql -h $DB_HOST -p $DB_PORT -U postgres -c "GRANT ALL PRIVILEGES ON DATABASE $DB_NAME TO $DB_USER;" 2>&1 | Out-Null

Write-Host "Database setup complete!" -ForegroundColor Green
Write-Host ""
Write-Host "Connection string: postgresql://${DB_USER}:${DB_PASSWORD}@${DB_HOST}:${DB_PORT}/${DB_NAME}" -ForegroundColor Cyan

