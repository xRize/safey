import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { analyzeRouter } from './routes/analyze.js';
import { gptRouter } from './routes/gpt.js';
import { stripeRouter } from './routes/stripe.js';
import { userRouter } from './routes/user.js';
import { authRouter } from './routes/auth.js';
import { initDB } from './db/index.js';
import { checkOllamaHealth } from './services/ollama.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(helmet());
app.use(cors({
  origin: process.env.ALLOWED_ORIGINS?.split(',') || '*',
  credentials: true
}));
app.use(express.json({ limit: '1mb' }));

// Serve Safey static files if PORT is 3005
if (PORT === 3005 || PORT === '3005') {
  const safeyPath = path.join(__dirname, '../../Safey');
  app.use(express.static(safeyPath));
  
  // Serve index.html for root route
  app.get('/', (req, res) => {
    res.sendFile(path.join(safeyPath, 'index.html'));
  });
} else {
  // Root route - API info
  app.get('/', (req, res) => {
    res.json({
      name: 'SmartTrust API',
      version: '0.1.0',
      status: 'running',
      endpoints: {
        health: '/health',
        auth: {
          register: 'POST /api/auth/register',
          login: 'POST /api/auth/login',
          verify: 'GET /api/auth/verify',
          logout: 'POST /api/auth/logout'
        },
        analyze: 'POST /api/analyze',
        gptAnalyze: 'POST /api/gpt-analyze',
        userPlan: 'GET /api/user/me/plan (auth) or GET /api/user/:userId/plan',
        userHistory: 'GET /api/user/me/history (auth) or GET /api/user/:userId/history',
        createUser: 'POST /api/user/by-email',
        setPlan: 'POST /api/user/me/set-plan (auth) or POST /api/user/:userId/set-plan'
      },
      documentation: 'See README.md for API documentation'
    });
  });
}

// Health check
app.get('/health', async (req, res) => {
  const health: any = {
    status: 'ok',
    timestamp: new Date().toISOString(),
    services: {
      database: 'unknown',
      ollama: 'unknown'
    }
  };

  // Check database
  try {
    const { pool } = await import('./db/index.js');
    await pool.query('SELECT NOW()');
    health.services.database = 'healthy';
  } catch (err) {
    health.services.database = 'unhealthy';
    health.status = 'degraded';
  }

  // Check Ollama
  try {
    const { checkOllamaHealth } = await import('./services/ollama.js');
    const ollamaHealth = await checkOllamaHealth();
    health.services.ollama = ollamaHealth.available ? 'healthy' : 'unavailable';
    if (ollamaHealth.available) {
      health.services.ollamaModel = ollamaHealth.model;
    } else {
      health.services.ollamaError = ollamaHealth.error;
    }
  } catch (err: any) {
    health.services.ollama = 'error';
    health.services.ollamaError = err.message;
  }

  const statusCode = health.status === 'ok' ? 200 : 503;
  res.status(statusCode).json(health);
});

// Routes
app.use('/api/auth', authRouter);
app.use('/api/analyze', analyzeRouter);
app.use('/api/ai-analyze', (await import('./routes/ai-analyze.js')).aiAnalyzeRouter);
app.use('/api/gpt-analyze', gptRouter);
app.use('/api/stripe', stripeRouter);
app.use('/api/user', userRouter);

// Error handler
app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('Error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// Initialize database and start server
async function start() {
  try {
    // Manage Ollama: kill existing instances and start new one
    try {
      // @ts-ignore - manage-ollama.js is a JS file without type definitions
      const { manageOllama } = await import('../scripts/manage-ollama.js');
      await manageOllama();
    } catch (err) {
      console.warn('⚠️  Could not manage Ollama automatically:', err);
      console.warn('   You may need to start Ollama manually: ollama serve');
    }
    
    console.log('🔌 Connecting to database...');
    await initDB();
    console.log('✅ Database connected');
    
    app.listen(PORT, async () => {
      console.log('');
      console.log('🚀 SmartTrust Backend Server');
      console.log('============================');
      console.log(`📍 Server running on http://localhost:${PORT}`);
      console.log(`🏥 Health check: http://localhost:${PORT}/health`);
      console.log('');
      
      // Warn about missing API keys
      const openaiKey = process.env.OPENAI_API_KEY || '';
      const stripeKey = process.env.STRIPE_SECRET_KEY || '';
      
      if (!openaiKey || openaiKey.includes('placeholder') || openaiKey.includes('your_')) {
        console.warn('⚠️  OPENAI_API_KEY not configured - GPT features will be disabled');
        console.warn('   App will work with heuristics-only analysis');
      }
      if (!stripeKey || stripeKey.includes('placeholder') || stripeKey.includes('your_')) {
        console.warn('⚠️  STRIPE_SECRET_KEY not configured - Payment features will be disabled');
        console.warn('   App will work in free mode only');
      }
      
      if (openaiKey && !openaiKey.includes('placeholder') && !openaiKey.includes('your_')) {
        console.log('✅ OpenAI configured - GPT features enabled');
      }
      if (stripeKey && !stripeKey.includes('placeholder') && !stripeKey.includes('your_')) {
        console.log('✅ Stripe configured - Payment features enabled');
      }
      
      // Check Ollama availability
      const ollamaUrl = process.env.OLLAMA_URL || 'http://localhost:11434';
      const ollamaModel = process.env.OLLAMA_MODEL || 'llama2';
      if (ollamaUrl && !ollamaUrl.includes('placeholder')) {
        console.log('');
        console.log('🔍 Checking Ollama availability...');
        try {
          const ollamaHealth = await checkOllamaHealth();
          if (ollamaHealth.available) {
            console.log(`✅ Ollama configured and available - Model: ${ollamaHealth.model || ollamaModel}`);
            console.log(`   AI-powered link content analysis enabled`);
            if (ollamaHealth.availableModels && ollamaHealth.availableModels.length > 0) {
              console.log(`   Available models: ${ollamaHealth.availableModels.join(', ')}`);
            }
            // Don't show error if model exists but test timed out - that's expected on first load
          } else {
            console.warn(`⚠️  Ollama not available: ${ollamaHealth.error || 'Unknown error'}`);
            console.warn('   AI analysis will be skipped for suspicious links');
            if (ollamaHealth.availableModels && ollamaHealth.availableModels.length > 0) {
              console.warn(`   Available models: ${ollamaHealth.availableModels.join(', ')}`);
            }
            console.warn(`   To fix: Run: ollama pull ${ollamaModel}`);
          }
        } catch (err: any) {
          console.warn(`⚠️  Ollama health check failed: ${err.message}`);
          console.warn('   AI analysis will be skipped for suspicious links');
        }
      } else {
        console.log('');
        console.log('ℹ️  Ollama not configured - AI link content analysis disabled');
        console.log('   Set OLLAMA_URL in .env to enable (default: http://localhost:11434)');
      }
      
      console.log('');
    });
  } catch (err: any) {
    console.error('❌ Failed to start server:', err.message);
    console.error('');
    console.error('💡 Troubleshooting:');
    console.error('   1. Make sure PostgreSQL is running');
    console.error('   2. Check your DATABASE_URL in .env');
    console.error('   3. Run: npm run setup');
    console.error('   4. Or use Docker: docker-compose up -d db');
    process.exit(1);
  }
}

start();

