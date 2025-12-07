#!/usr/bin/env node

/**
 * SmartTrust Backend Setup Script
 * Automatically sets up the database and runs migrations
 */

import { execSync } from 'child_process';
import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, '..');

// Load environment variables
const envPath = join(rootDir, '.env');
if (!existsSync(envPath)) {
  console.log('📝 Creating .env file from template...');
  
  // Create .env from template
  const fs = await import('fs');
  const examplePath = join(rootDir, '.env.example');
  
  if (existsSync(examplePath)) {
    fs.copyFileSync(examplePath, envPath);
    console.log('✅ Created .env file from .env.example');
  } else {
    // Create .env with default values if .env.example doesn't exist
    const defaultEnv = `# Database Configuration
DATABASE_URL=postgresql://smarttrust_user:smarttrust_pass@localhost:5432/smarttrust
DATABASE_SSL=false

# Server Configuration
PORT=3000
NODE_ENV=development
ALLOWED_ORIGINS=http://localhost:5173,chrome-extension://*

# OpenAI Configuration
# Get your API key from https://platform.openai.com/api-keys
OPENAI_API_KEY=your_openai_api_key_here
OPENAI_MODEL=gpt-3.5-turbo

# Stripe Configuration
# Get your keys from https://dashboard.stripe.com/test/apikeys
STRIPE_SECRET_KEY=sk_test_your_stripe_secret_key_here
STRIPE_WEBHOOK_SECRET=whsec_your_webhook_secret_here

# Frontend URL (for Stripe redirects)
FRONTEND_URL=http://localhost:3000
`;
    fs.writeFileSync(envPath, defaultEnv);
    console.log('✅ Created .env file with default values');
  }
  console.log('⚠️  Please update .env with your API keys before using GPT or payment features.');
}

dotenv.config({ path: envPath });

console.log('🚀 SmartTrust Backend Setup');
console.log('==========================\n');

// Check if Docker is available
let useDocker = false;
try {
  execSync('docker --version', { stdio: 'ignore' });
  useDocker = true;
  console.log('✅ Docker detected');
} catch {
  console.log('ℹ️  Docker not found, assuming PostgreSQL is installed locally');
}

// Start Docker services if available
if (useDocker) {
  console.log('\n🐳 Starting Docker services...');
  try {
    execSync('docker-compose up -d db redis', { 
      cwd: join(rootDir, '..'),
      stdio: 'inherit'
    });
    console.log('✅ Docker services started');
    
    // Wait for database to be ready
    console.log('⏳ Waiting for database to be ready...');
    await new Promise(resolve => setTimeout(resolve, 5000));
  } catch (err) {
    console.warn('⚠️  Could not start Docker services. Make sure docker-compose is available.');
    console.warn('   You can start them manually: docker-compose up -d');
  }
}

// Check database connection
console.log('\n🔌 Testing database connection...');
let dbConnected = false;
let connectionError = null;

try {
  const { Pool } = await import('pg');
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL || 'postgresql://smarttrust_user:smarttrust_pass@localhost:5432/smarttrust',
    ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : false
  });
  
  await pool.query('SELECT NOW()');
  console.log('✅ Database connection successful');
  await pool.end();
  dbConnected = true;
} catch (err) {
  connectionError = err;
  console.error('❌ Database connection failed!');
  console.error('   Error:', err.message);
  
  // Check if it's an authentication or permission error
  if (err.message.includes('password authentication failed') || 
      err.message.includes('does not exist') ||
      err.message.includes('permission denied')) {
    console.log('\n💡 Database needs setup.');
    console.log('   Running complete database setup...\n');
    
    // Try to run the complete setup script
    const { execSync } = await import('child_process');
    const { platform } = await import('os');
    
    try {
      if (platform() === 'win32') {
        console.log('   Running: npm run setup-db-complete\n');
        execSync('npm run setup-db-complete', { 
          cwd: rootDir,
          stdio: 'inherit'
        });
        
        // Grant permissions
        console.log('\n   Granting permissions...\n');
        execSync('npm run grant-permissions', { 
          cwd: rootDir,
          stdio: 'inherit'
        });
        
        // Retry connection
        console.log('\n🔄 Retrying database connection...');
        const retryPool = new Pool({
          connectionString: process.env.DATABASE_URL || 'postgresql://smarttrust_user:smarttrust_pass@localhost:5432/smarttrust',
          ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : false
        });
        await retryPool.query('SELECT NOW()');
        console.log('✅ Database connection successful after setup!');
        await retryPool.end();
        dbConnected = true;
      } else {
        console.log('   Please run: npm run setup:db');
        process.exit(1);
      }
    } catch (fixErr) {
      console.error('\n❌ Automatic setup failed. Please run manually:');
      console.error('   npm run setup-db');
      process.exit(1);
    }
  }
  
  if (!dbConnected) {
    console.log('\n💡 Troubleshooting:');
    console.log('   1. Make sure PostgreSQL is running');
    console.log('   2. Check your DATABASE_URL in .env');
    console.log('   3. Run: npm run setup-db');
    console.log('   4. Or use Docker: docker-compose up -d db');
    process.exit(1);
  }
}

// Run migrations
console.log('\n📦 Running database migrations...');
try {
  const { runMigrations } = await import('../src/db/migrations.js');
  await runMigrations();
  console.log('✅ Migrations completed');
} catch (err) {
  console.error('❌ Migration failed:', err.message);
  process.exit(1);
}

console.log('\n✅ Setup complete!');
console.log('\n📝 Next steps:');
console.log('   1. Update .env with your OpenAI API key');
console.log('   2. Update .env with your Stripe keys (for payments)');
console.log('   3. Run: npm run dev (or npm start)');
console.log('\n🎉 Happy coding!');

