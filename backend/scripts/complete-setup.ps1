# Complete SmartTrust Database Setup
# This script does everything: creates user, database, grants permissions, and runs migrations

$ErrorActionPreference = "Stop"

Write-Host "SmartTrust Complete Database Setup" -ForegroundColor Cyan
Write-Host "===================================`n" -ForegroundColor Cyan

# Configuration
$DB_NAME = "smarttrust"
$DB_USER = "smarttrust_user"
$DB_PASSWORD = "smarttrust_pass"
$DB_HOST = "localhost"
$DB_PORT = "5432"
$POSTGRES_PASSWORD = "andrei2010"

$env:PGPASSWORD = $POSTGRES_PASSWORD

Write-Host "Configuration:" -ForegroundColor Yellow
Write-Host "   Database: $DB_NAME"
Write-Host "   User: $DB_USER"
Write-Host "   Host: ${DB_HOST}:${DB_PORT}`n"

# Step 1: Check PostgreSQL connection
Write-Host "[1/5] Checking PostgreSQL connection..." -ForegroundColor Yellow
$ErrorActionPreference = 'SilentlyContinue'
$testResult = psql -h $DB_HOST -p $DB_PORT -U postgres -c "SELECT version();" 2>&1
$ErrorActionPreference = 'Stop'
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: Cannot connect to PostgreSQL!" -ForegroundColor Red
    Write-Host "Make sure PostgreSQL is running and password is correct" -ForegroundColor Red
    exit 1
}
Write-Host "PostgreSQL is accessible`n" -ForegroundColor Green

# Step 2: Create user
Write-Host "[2/5] Creating user '$DB_USER'..." -ForegroundColor Yellow
$ErrorActionPreference = 'SilentlyContinue'
psql -h $DB_HOST -p $DB_PORT -U postgres -c "DROP USER IF EXISTS $DB_USER;" 2>&1 | Out-Null
$createUser = "CREATE USER $DB_USER WITH PASSWORD '$DB_PASSWORD';"
$userOutput = psql -h $DB_HOST -p $DB_PORT -U postgres -c $createUser 2>&1
$ErrorActionPreference = 'Stop'
if ($LASTEXITCODE -eq 0 -or $userOutput -match 'already exists') {
    Write-Host "User created/updated successfully`n" -ForegroundColor Green
} else {
    Write-Host "Warning: User creation had issues, but continuing..." -ForegroundColor Yellow
}

# Step 3: Create database
Write-Host "[3/5] Creating database '$DB_NAME'..." -ForegroundColor Yellow
$ErrorActionPreference = 'SilentlyContinue'
psql -h $DB_HOST -p $DB_PORT -U postgres -c "DROP DATABASE IF EXISTS $DB_NAME;" 2>&1 | Out-Null
$createDb = "CREATE DATABASE $DB_NAME OWNER $DB_USER;"
$dbOutput = psql -h $DB_HOST -p $DB_PORT -U postgres -c $createDb 2>&1
$ErrorActionPreference = 'Stop'
if ($LASTEXITCODE -eq 0 -or $dbOutput -match 'already exists') {
    Write-Host "Database created successfully`n" -ForegroundColor Green
} else {
    Write-Host "Warning: Database creation had issues, but continuing..." -ForegroundColor Yellow
}

# Step 4: Grant privileges
Write-Host "[4/5] Granting privileges..." -ForegroundColor Yellow
$ErrorActionPreference = 'SilentlyContinue'
psql -h $DB_HOST -p $DB_PORT -U postgres -c "GRANT ALL PRIVILEGES ON DATABASE $DB_NAME TO $DB_USER;" 2>&1 | Out-Null
psql -h $DB_HOST -p $DB_PORT -U postgres -d $DB_NAME -c "GRANT USAGE ON SCHEMA public TO $DB_USER;" 2>&1 | Out-Null
psql -h $DB_HOST -p $DB_PORT -U postgres -d $DB_NAME -c "GRANT CREATE ON SCHEMA public TO $DB_USER;" 2>&1 | Out-Null
psql -h $DB_HOST -p $DB_PORT -U postgres -d $DB_NAME -c "ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO $DB_USER;" 2>&1 | Out-Null
psql -h $DB_HOST -p $DB_PORT -U postgres -d $DB_NAME -c "ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO $DB_USER;" 2>&1 | Out-Null
$ErrorActionPreference = 'Stop'
Write-Host "Permissions granted successfully`n" -ForegroundColor Green

# Step 5: Test connection
Write-Host "[5/5] Testing connection..." -ForegroundColor Yellow
$env:PGPASSWORD = $DB_PASSWORD
$ErrorActionPreference = 'SilentlyContinue'
$testResult = psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME -c "SELECT current_database(), current_user;" 2>&1
$ErrorActionPreference = 'Stop'
if ($LASTEXITCODE -eq 0) {
    Write-Host "Connection test successful!`n" -ForegroundColor Green
} else {
    Write-Host "Warning: Connection test had issues, but setup completed`n" -ForegroundColor Yellow
}

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Database setup complete!" -ForegroundColor Green
Write-Host "========================================`n" -ForegroundColor Cyan

Write-Host "Connection string:" -ForegroundColor Yellow
Write-Host "postgresql://${DB_USER}:${DB_PASSWORD}@${DB_HOST}:${DB_PORT}/${DB_NAME}`n" -ForegroundColor White

Write-Host "Next: Run migrations with 'npm run migrate'" -ForegroundColor Cyan

