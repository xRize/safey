#!/usr/bin/env node

/**
 * Check if all required environment variables are set
 */

import { existsSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, '..');

const envPath = join(rootDir, '.env');

if (!existsSync(envPath)) {
  console.error('❌ .env file not found!');
  console.log('💡 Run: npm run setup');
  process.exit(1);
}

const envContent = readFileSync(envPath, 'utf-8');
const required = [
  'DATABASE_URL',
  'PORT'
];

const optional = [
  'OPENAI_API_KEY',
  'STRIPE_SECRET_KEY',
  'STRIPE_WEBHOOK_SECRET'
];

let hasErrors = false;
let hasWarnings = false;

console.log('🔍 Checking environment variables...\n');

// Check required
for (const key of required) {
  if (!envContent.includes(`${key}=`) || envContent.match(new RegExp(`${key}=\\s*$`)) || envContent.includes(`${key}=your_`)) {
    console.error(`❌ Required: ${key} is missing or not configured`);
    hasErrors = true;
  } else {
    console.log(`✅ ${key} is set`);
  }
}

// Check optional
for (const key of optional) {
  if (!envContent.includes(`${key}=`) || envContent.match(new RegExp(`${key}=\\s*$`)) || envContent.includes(`${key}=your_`)) {
    console.warn(`⚠️  Optional: ${key} is not set (some features may not work)`);
    hasWarnings = true;
  } else {
    console.log(`✅ ${key} is set`);
  }
}

console.log('');

if (hasErrors) {
  console.error('❌ Some required variables are missing!');
  process.exit(1);
}

if (hasWarnings) {
  console.warn('⚠️  Some optional variables are missing. The app will work but some features may be disabled.');
} else {
  console.log('✅ All environment variables are configured!');
}

