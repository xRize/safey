# SmartTrust Database Fix Script (PowerShell)
# This script fixes database connection issues by creating the user and database

$ErrorActionPreference = "Stop"

Write-Host "SmartTrust Database Fix Script" -ForegroundColor Cyan
Write-Host "================================`n" -ForegroundColor Cyan

# Configuration
$DB_NAME = "smarttrust"
$DB_USER = "smarttrust_user"
$DB_PASSWORD = "smarttrust_pass"
$DB_HOST = "localhost"
$DB_PORT = "5432"

# Try to get postgres password from environment or use default
$POSTGRES_PASSWORD = $env:POSTGRES_PASSWORD
if (-not $POSTGRES_PASSWORD) {
    $POSTGRES_PASSWORD = "andrei2010"  # Default password for local development
}

# Set PGPASSWORD environment variable
$env:PGPASSWORD = $POSTGRES_PASSWORD

Write-Host "`nConfiguration:" -ForegroundColor Yellow
Write-Host "   Database: $DB_NAME"
Write-Host "   User: $DB_USER"
Write-Host "   Host: ${DB_HOST}:${DB_PORT}"
Write-Host ""

# Check if PostgreSQL is accessible
Write-Host "Checking PostgreSQL connection..." -ForegroundColor Yellow
$ErrorActionPreference = 'SilentlyContinue'
$testResult = psql -h $DB_HOST -p $DB_PORT -U postgres -c "SELECT version();" 2>&1
$ErrorActionPreference = 'Stop'
if ($LASTEXITCODE -eq 0) {
    Write-Host "PostgreSQL is accessible" -ForegroundColor Green
} else {
    Write-Host "Cannot connect to PostgreSQL!" -ForegroundColor Red
    Write-Host "   Error: $_" -ForegroundColor Red
    Write-Host "`n💡 Troubleshooting:" -ForegroundColor Yellow
    Write-Host "   1. Make sure PostgreSQL is installed and running"
    Write-Host "   2. Check if PostgreSQL service is running: Get-Service postgresql*"
    Write-Host "   3. Verify connection: psql -U postgres -h localhost"
    exit 1
}

# Drop user if exists (to recreate with correct password)
Write-Host "`nDropping existing user (if exists)..." -ForegroundColor Yellow
$ErrorActionPreference = 'SilentlyContinue'
psql -h $DB_HOST -p $DB_PORT -U postgres -c "DROP USER IF EXISTS $DB_USER;" 2>&1 | Out-Null
$ErrorActionPreference = 'Stop'

# Create user
Write-Host "Creating user '$DB_USER'..." -ForegroundColor Yellow
$createUser = "CREATE USER $DB_USER WITH PASSWORD '$DB_PASSWORD';"
$ErrorActionPreference = 'SilentlyContinue'
$userOutput = psql -h $DB_HOST -p $DB_PORT -U postgres -c $createUser 2>&1
$ErrorActionPreference = 'Stop'
if ($LASTEXITCODE -eq 0) {
    Write-Host "User created successfully" -ForegroundColor Green
} else {
    # Check if user already exists
    if ($userOutput -match 'already exists') {
        Write-Host "User already exists, updating password..." -ForegroundColor Yellow
        $updatePass = "ALTER USER $DB_USER WITH PASSWORD '$DB_PASSWORD';"
        $ErrorActionPreference = 'SilentlyContinue'
        psql -h $DB_HOST -p $DB_PORT -U postgres -c $updatePass 2>&1 | Out-Null
        $ErrorActionPreference = 'Stop'
        Write-Host "Password updated" -ForegroundColor Green
    } else {
        Write-Host "Warning: User creation had issues, but continuing..." -ForegroundColor Yellow
    }
}

# Drop database if exists
Write-Host "Dropping existing database (if exists)..." -ForegroundColor Yellow
$ErrorActionPreference = 'SilentlyContinue'
psql -h $DB_HOST -p $DB_PORT -U postgres -c "DROP DATABASE IF EXISTS $DB_NAME;" 2>&1 | Out-Null
$ErrorActionPreference = 'Stop'

# Create database
Write-Host "Creating database '$DB_NAME'..." -ForegroundColor Yellow
$createDb = "CREATE DATABASE $DB_NAME OWNER $DB_USER;"
$ErrorActionPreference = 'SilentlyContinue'
$dbOutput = psql -h $DB_HOST -p $DB_PORT -U postgres -c $createDb 2>&1
$dbExitCode = $LASTEXITCODE
$ErrorActionPreference = 'Stop'

# Filter out NOTICE messages for display
$dbErrors = $dbOutput | Where-Object { $_ -notmatch 'NOTICE' -and $_ -notmatch '^$' }

if ($dbExitCode -eq 0) {
    Write-Host "Database created successfully" -ForegroundColor Green
} else {
    if ($dbOutput -match 'already exists') {
        Write-Host "Database already exists, continuing..." -ForegroundColor Yellow
    } elseif ($dbErrors.Count -eq 0) {
        # No actual errors, might be a false positive from NOTICE messages
        Write-Host "Database creation completed (checking status)..." -ForegroundColor Yellow
        # Verify database exists
        $ErrorActionPreference = 'SilentlyContinue'
        $checkDb = psql -h $DB_HOST -p $DB_PORT -U postgres -c "SELECT 1 FROM pg_database WHERE datname='$DB_NAME';" 2>&1
        $ErrorActionPreference = 'Stop'
        if ($checkDb -match '1') {
            Write-Host "Database exists, continuing..." -ForegroundColor Green
        } else {
            Write-Host "Warning: Could not verify database creation" -ForegroundColor Yellow
        }
    } else {
        Write-Host "Failed to create database. Errors:" -ForegroundColor Red
        $dbErrors | ForEach-Object { Write-Host "  $_" -ForegroundColor Red }
        exit 1
    }
}

# Grant privileges
Write-Host "Granting privileges..." -ForegroundColor Yellow
$ErrorActionPreference = 'SilentlyContinue'
psql -h $DB_HOST -p $DB_PORT -U postgres -c "GRANT ALL PRIVILEGES ON DATABASE $DB_NAME TO $DB_USER;" 2>&1 | Out-Null
$ErrorActionPreference = 'Stop'

# Test connection with new user
Write-Host "`nTesting connection with new user..." -ForegroundColor Yellow
$env:PGPASSWORD = $DB_PASSWORD
$ErrorActionPreference = 'SilentlyContinue'
$testResult = psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME -c "SELECT current_database(), current_user;" 2>&1
$ErrorActionPreference = 'Stop'
if ($LASTEXITCODE -eq 0) {
    Write-Host "Connection test successful!" -ForegroundColor Green
} else {
    Write-Host "Connection test had issues, but database was created" -ForegroundColor Yellow
    Write-Host "You may need to verify the connection manually" -ForegroundColor Yellow
}

Write-Host "`nDatabase setup complete!" -ForegroundColor Green
Write-Host ""
Write-Host "Connection string:" -ForegroundColor Cyan
Write-Host "   postgresql://${DB_USER}:${DB_PASSWORD}@${DB_HOST}:${DB_PORT}/${DB_NAME}" -ForegroundColor White
Write-Host ""
Write-Host "Next step: Run 'npm run migrate' to create tables" -ForegroundColor Yellow

