#!/usr/bin/env node

/**
 * Quick start script for backend
 * Checks setup and starts the server
 */

import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

console.log('🚀 Starting SmartTrust Backend...\n');

// Check if .env exists
const envPath = join(__dirname, 'backend', '.env');
if (!existsSync(envPath)) {
  console.log('⚠️  .env file not found. Running setup...\n');
  try {
    execSync('npm run setup', { 
      cwd: join(__dirname, 'backend'),
      stdio: 'inherit'
    });
  } catch (err) {
    console.error('❌ Setup failed. Please run: cd backend && npm run setup');
    process.exit(1);
  }
}

// Start the server
console.log('📦 Starting server...\n');
try {
  execSync('npm run dev', {
    cwd: join(__dirname, 'backend'),
    stdio: 'inherit'
  });
} catch (err) {
  console.error('❌ Failed to start server');
  process.exit(1);
}

