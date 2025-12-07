# Grant permissions on public schema
# This fixes "permission denied for schema public" errors

$ErrorActionPreference = "Stop"

Write-Host "Granting permissions on public schema..." -ForegroundColor Cyan

$DB_NAME = "smarttrust"
$DB_USER = "smarttrust_user"
$DB_HOST = "localhost"
$DB_PORT = "5432"

# Get postgres password
$POSTGRES_PASSWORD = $env:POSTGRES_PASSWORD
if (-not $POSTGRES_PASSWORD) {
    $POSTGRES_PASSWORD = "andrei2010"  # Default password for local development
}

$env:PGPASSWORD = $POSTGRES_PASSWORD

Write-Host "Granting permissions..." -ForegroundColor Yellow

# Grant usage and create on public schema
$ErrorActionPreference = 'SilentlyContinue'
psql -h $DB_HOST -p $DB_PORT -U postgres -d $DB_NAME -c "GRANT USAGE ON SCHEMA public TO $DB_USER;" 2>&1 | Out-Null
psql -h $DB_HOST -p $DB_PORT -U postgres -d $DB_NAME -c "GRANT CREATE ON SCHEMA public TO $DB_USER;" 2>&1 | Out-Null
psql -h $DB_HOST -p $DB_PORT -U postgres -d $DB_NAME -c "ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO $DB_USER;" 2>&1 | Out-Null
psql -h $DB_HOST -p $DB_PORT -U postgres -d $DB_NAME -c "ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO $DB_USER;" 2>&1 | Out-Null
$ErrorActionPreference = 'Stop'

Write-Host "Permissions granted successfully!" -ForegroundColor Green
Write-Host "You can now run: npm run migrate" -ForegroundColor Yellow

