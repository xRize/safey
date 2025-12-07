# Quick fix for database authentication issues
# This script will recreate the database user with the correct password

Write-Host "🔧 Quick Database Fix" -ForegroundColor Cyan
Write-Host "===================`n" -ForegroundColor Cyan

# Check if psql is available
try {
    $null = Get-Command psql -ErrorAction Stop
} catch {
    Write-Host "❌ PostgreSQL client (psql) not found in PATH" -ForegroundColor Red
    Write-Host "`n💡 Solutions:" -ForegroundColor Yellow
    Write-Host "   1. Add PostgreSQL bin directory to PATH"
    Write-Host "      Example: C:\Program Files\PostgreSQL\15\bin"
    Write-Host "   2. Or use full path: & 'C:\Program Files\PostgreSQL\15\bin\psql.exe' ..."
    Write-Host "   3. Or install PostgreSQL from: https://www.postgresql.org/download/windows/"
    exit 1
}

Write-Host "✅ PostgreSQL client found`n" -ForegroundColor Green

# Prompt for postgres password
$postgresPass = Read-Host "Enter PostgreSQL 'postgres' user password" -AsSecureString
$BSTR = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($postgresPass)
$POSTGRES_PASSWORD = [System.Runtime.InteropServices.Marshal]::PtrToStringAuto($BSTR)
$env:PGPASSWORD = $POSTGRES_PASSWORD

Write-Host "`nCreating database user and database..." -ForegroundColor Yellow

# Create user
psql -h localhost -U postgres -c "DROP USER IF EXISTS smarttrust_user;" 2>&1 | Out-Null
psql -h localhost -U postgres -c "CREATE USER smarttrust_user WITH PASSWORD 'smarttrust_pass';" 2>&1 | Out-Null

# Create database
psql -h localhost -U postgres -c "DROP DATABASE IF EXISTS smarttrust;" 2>&1 | Out-Null
psql -h localhost -U postgres -c "CREATE DATABASE smarttrust OWNER smarttrust_user;" 2>&1 | Out-Null

# Grant privileges
psql -h localhost -U postgres -c "GRANT ALL PRIVILEGES ON DATABASE smarttrust TO smarttrust_user;" 2>&1 | Out-Null

Write-Host "`n✅ Database fixed!" -ForegroundColor Green
Write-Host "`nNow run: cd backend && npm run migrate" -ForegroundColor Yellow

