# SmartTrust API Test Script
# Tests all API endpoints

$baseUrl = "http://localhost:3000"

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "SmartTrust API Test Suite" -ForegroundColor Cyan
Write-Host "========================================`n" -ForegroundColor Cyan

# Test 1: Health Check
Write-Host "[1/4] Health Check..." -ForegroundColor Yellow
try {
    $health = Invoke-RestMethod -Uri "$baseUrl/health"
    Write-Host "  ✅ Server is running" -ForegroundColor Green
    Write-Host "  Status: $($health.status)" -ForegroundColor Gray
} catch {
    Write-Host "  ❌ Server not responding" -ForegroundColor Red
    Write-Host "  Make sure server is running: npm run dev" -ForegroundColor Yellow
    exit 1
}

# Test 2: Analyze Suspicious Link
Write-Host "`n[2/4] Analyzing suspicious link (HTTP, no HTTPS)..." -ForegroundColor Yellow
$suspiciousLink = @{
    links = @(
        @{
            href = "http://suspicious-site.com/path?param=value"
            text = "Free money click here"
            targetDomain = "suspicious-site.com"
            contextSnippet = "Limited time offer! Click now!"
        }
    )
    domain = "test.com"
} | ConvertTo-Json -Depth 10

try {
    $result = Invoke-RestMethod -Uri "$baseUrl/api/analyze" `
        -Method POST `
        -Body $suspiciousLink `
        -ContentType "application/json"
    
    $verdict = $result.analyses[0].verdict
    Write-Host "  ✅ Analysis complete" -ForegroundColor Green
    Write-Host "  Trust Score: $([math]::Round($verdict.trustScore * 100, 0))%" -ForegroundColor Cyan
    Write-Host "  Category: $($verdict.category)" -ForegroundColor Cyan
    Write-Host "  Issues: $($verdict.issues -join ', ')" -ForegroundColor Cyan
    
    if ($verdict.category -ne "SAFE") {
        Write-Host "  ✅ Correctly flagged as suspicious" -ForegroundColor Green
    } else {
        Write-Host "  ⚠️  Should have been flagged as suspicious" -ForegroundColor Yellow
    }
} catch {
    Write-Host "  ❌ Analysis failed: $_" -ForegroundColor Red
}

# Test 3: Analyze Safe Link
Write-Host "`n[3/4] Analyzing safe link (HTTPS, known domain)..." -ForegroundColor Yellow
$safeLink = @{
    links = @(
        @{
            href = "https://github.com/microsoft"
            text = "GitHub"
            targetDomain = "github.com"
            contextSnippet = "Open source repository"
        }
    )
    domain = "test.com"
} | ConvertTo-Json -Depth 10

try {
    $result = Invoke-RestMethod -Uri "$baseUrl/api/analyze" `
        -Method POST `
        -Body $safeLink `
        -ContentType "application/json"
    
    $verdict = $result.analyses[0].verdict
    Write-Host "  ✅ Analysis complete" -ForegroundColor Green
    Write-Host "  Trust Score: $([math]::Round($verdict.trustScore * 100, 0))%" -ForegroundColor Cyan
    Write-Host "  Category: $($verdict.category)" -ForegroundColor Cyan
    
    if ($verdict.category -eq "SAFE") {
        Write-Host "  ✅ Correctly identified as safe" -ForegroundColor Green
    } else {
        Write-Host "  ⚠️  Should have been identified as safe" -ForegroundColor Yellow
    }
} catch {
    Write-Host "  ❌ Analysis failed: $_" -ForegroundColor Red
}

# Test 4: URL Shortener
Write-Host "`n[4/4] Analyzing URL shortener..." -ForegroundColor Yellow
$shortenerLink = @{
    links = @(
        @{
            href = "https://bit.ly/abc123"
            text = "Click here"
            targetDomain = "bit.ly"
            contextSnippet = "Short link"
        }
    )
    domain = "test.com"
} | ConvertTo-Json -Depth 10

try {
    $result = Invoke-RestMethod -Uri "$baseUrl/api/analyze" `
        -Method POST `
        -Body $shortenerLink `
        -ContentType "application/json"
    
    $verdict = $result.analyses[0].verdict
    Write-Host "  ✅ Analysis complete" -ForegroundColor Green
    Write-Host "  Trust Score: $([math]::Round($verdict.trustScore * 100, 0))%" -ForegroundColor Cyan
    Write-Host "  Category: $($verdict.category)" -ForegroundColor Cyan
    Write-Host "  Issues: $($verdict.issues -join ', ')" -ForegroundColor Cyan
    
    if ($verdict.issues -contains "short_url") {
        Write-Host "  ✅ Correctly detected URL shortener" -ForegroundColor Green
    }
} catch {
    Write-Host "  ❌ Analysis failed: $_" -ForegroundColor Red
}

Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "✅ All tests completed!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "`nNext steps:" -ForegroundColor Yellow
Write-Host "  1. Load extension in Chrome" -ForegroundColor White
Write-Host "  2. Visit a website with links" -ForegroundColor White
Write-Host "  3. Check extension popup for scan results" -ForegroundColor White

