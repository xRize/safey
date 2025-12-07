# SmartTrust

A smart, GPT-powered browser extension that scans links on visited websites, evaluates their trustworthiness, and warns users before navigating to risky destinations.

## Features

- 🔍 **Link Scanning**: Automatically scans all links on a page using lightweight heuristics
- 🤖 **GPT-Powered Analysis**: Premium users get AI-powered explanations (optional - works without AI)
- 🎯 **Per-Site Toggle**: Enable/disable the extension per domain
- 💎 **Membership Tiers**: Free (basic), Trial (30 days), Premium ($5/month)
- 🌍 **Localization**: Romanian + English UI
- 🔒 **Privacy-First**: Never sends full page HTML by default, only sanitized metadata

## Quick Start

### 1. Install Dependencies
```powershell
npm install
```

### 2. Setup Database
```powershell
# Option A: Using Docker (Recommended)
docker-compose up -d

# Option B: Local PostgreSQL
cd backend
npm run setup-db
```

### 3. Setup Backend
```powershell
cd backend
npm run setup
```

This automatically:
- Creates `.env` file
- Sets up database
- Runs migrations
- Verifies everything works

### 4. Start Server
```powershell
cd backend
npm run dev
```

Server runs on `http://localhost:3000`

### 5. Build Extension
```powershell
cd extension
npm run build
```

### 6. Load Extension in Chrome
1. Open `chrome://extensions/`
2. Enable "Developer mode"
3. Click "Load unpacked"
4. Select `extension/dist` folder

## Admin: Set Yourself to Premium

```powershell
cd backend
npm run set-premium your-email@example.com
```

**Premium works without AI!** All advanced features work, AI shows as "not available" until you add `OPENAI_API_KEY`.

## Configuration

### Environment Variables (`backend/.env`)

```env
# Database (already configured)
DATABASE_URL=postgresql://smarttrust_user:smarttrust_pass@localhost:5432/smarttrust

# Server
PORT=3000

# OpenAI (optional - for GPT features)
OPENAI_API_KEY=sk-placeholder-key-replace-with-real-key-for-gpt-features

# Stripe (optional - for payments)
STRIPE_SECRET_KEY=sk_test_placeholder_replace_with_real_key_for_payments
```

**Note:** App works with placeholder keys! GPT and payment features will be disabled gracefully.

## API Endpoints

- `GET /health` - Health check
- `POST /api/analyze` - Analyze links (rate limited: 30/min)
- `POST /api/gpt-analyze` - GPT analysis (premium only, rate limited: 10/min)
- `GET /api/user/:userId/plan` - Get user plan
- `GET /api/user/:userId/history` - Get scan history
- `POST /api/user/by-email` - Get or create user by email
- `POST /api/user/:userId/set-plan` - Set user plan (admin)

## Testing

### Quick API Test
```powershell
# Health check
Invoke-RestMethod -Uri http://localhost:3000/health

# Analyze link
$body = @{
    links = @(@{
        href = "http://test.com"
        text = "Test"
        targetDomain = "test.com"
    })
    domain = "test.com"
} | ConvertTo-Json -Depth 10

Invoke-RestMethod -Uri http://localhost:3000/api/analyze `
    -Method POST -Body $body -ContentType "application/json"
```

### Run Test Script
```powershell
.\test-api.ps1
```

## Commands Reference

### Root Directory
```powershell
npm run dev              # Start backend server
npm run migrate          # Run database migrations
npm run setup-db         # Complete database setup
npm run fix-db           # Fix database issues
npm run grant-permissions # Fix permission issues
```

### Backend
```powershell
cd backend
npm run dev              # Start server (watch mode)
npm run build            # Build for production
npm run start            # Run production build
npm run setup            # Full automated setup
npm run migrate          # Run migrations
npm run set-premium      # Set user to premium (admin)
npm run check-env        # Verify environment variables
```

### Extension
```powershell
cd extension
npm run build            # Build extension
npm run dev              # Build with watch mode
npm run test             # Run tests
```

## Troubleshooting

### Database Connection Failed
```powershell
cd backend
npm run fix-db
```

### Port 3000 Already in Use
Edit `backend/.env`: `PORT=3001`

### Extension Won't Load
- Make sure you selected `extension/dist` folder (not parent)
- Rebuild: `cd extension && npm run build`
- Check browser console for errors

### GPT Analysis Not Working
- Expected if `OPENAI_API_KEY` is placeholder
- Premium features work without AI
- Add real OpenAI key to enable AI features

### Permission Denied (Database)
```powershell
cd backend
npm run grant-permissions
```

## Premium Features (Without AI)

When Premium is enabled but OpenAI is not configured:

✅ **Available:**
- Advanced heuristics analysis
- Detailed trust scoring (0-1)
- Risk categorization (SAFE/SUSPICIOUS/DANGEROUS)
- Issue detection (no HTTPS, URL shorteners, punycode, etc.)
- Per-site toggle
- Scan history
- All extension features

⚠️ **AI Features (Gracefully Handled):**
- Shows "AI analysis not available. OpenAI API key not configured."
- All other features work normally

## Adding Real API Keys

### OpenAI (for GPT features)
1. Get key: https://platform.openai.com/api-keys
2. Edit `backend/.env`: `OPENAI_API_KEY=sk-your-actual-key`
3. Restart server

### Stripe (for payments)
1. Get test keys: https://dashboard.stripe.com/test/apikeys
2. Edit `backend/.env`: `STRIPE_SECRET_KEY=sk_test_your_key`
3. Restart server

## Project Structure

```
.
├── extension/          # Browser extension
│   ├── src/
│   │   ├── contentScript/  # DOM scanner
│   │   ├── background/     # Service worker
│   │   ├── popup/         # Popup UI
│   │   └── options/        # Options page
│   └── dist/              # Built extension (load this in Chrome)
├── backend/            # API server
│   ├── src/
│   │   ├── routes/        # API routes
│   │   ├── services/      # Business logic
│   │   └── db/            # Database & migrations
│   └── scripts/           # Setup scripts
└── docker-compose.yml   # Docker services
```

## Architecture

- **Extension**: TypeScript + React (Vite) - Manifest V3
- **Backend**: Node.js + Express + TypeScript
- **Database**: PostgreSQL
- **Payments**: Stripe (subscriptions with trial)
- **AI**: OpenAI GPT-3.5-turbo (optional)

## Security & Privacy

- **No full page HTML sent**: Only sanitized link metadata
- **PII removal**: Emails, phones, credit cards stripped before GPT analysis
- **Rate limiting**: Prevents abuse and cost overruns
- **CSP headers**: Content Security Policy for extension pages
- **Secure storage**: API keys only on server, never in extension

## Membership Plans

- **Free**: Basic heuristics & safety rating (no GPT insights)
- **Trial**: 30-day free trial with full premium features
- **Premium**: $5/month with advanced scanning & GPT insights (when configured)

## Development

### Extension
```powershell
cd extension
npm run dev    # Watch mode
npm run build  # Production build
npm test       # Run tests
```

### Backend
```powershell
cd backend
npm run dev    # Watch mode with tsx
npm run build  # Production build
npm test       # Run tests
```

## CI/CD

GitHub Actions workflow:
- Lint code
- Run tests
- Build extension and backend
- Create extension ZIP artifact

## License

[Your License Here]
