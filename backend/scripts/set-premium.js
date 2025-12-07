#!/usr/bin/env node

/**
 * Admin script to set user to Premium plan
 * Usage: node scripts/set-premium.js <email>
 */

import dotenv from 'dotenv';
import { pool } from '../src/db/index.js';

dotenv.config();

const email = process.argv[2];

if (!email) {
  console.error('Usage: node scripts/set-premium.js <email>');
  console.error('Example: node scripts/set-premium.js admin@example.com');
  process.exit(1);
}

async function setPremium() {
  try {
    // First, check if user exists
    const userCheck = await pool.query(
      'SELECT id, email, plan FROM users WHERE email = $1',
      [email]
    );

    if (userCheck.rows.length === 0) {
      // Create user if doesn't exist
      console.log(`Creating user: ${email}`);
      const result = await pool.query(
        `INSERT INTO users (email, plan, plan_started_at)
         VALUES ($1, 'premium', now())
         RETURNING id, email, plan`,
        [email]
      );
      console.log('✅ User created with Premium plan!');
      console.log(`   ID: ${result.rows[0].id}`);
      console.log(`   Email: ${result.rows[0].email}`);
      console.log(`   Plan: ${result.rows[0].plan}`);
    } else {
      // Update existing user
      console.log(`Updating user: ${email}`);
      const result = await pool.query(
        `UPDATE users 
         SET plan = 'premium', 
             plan_started_at = CASE WHEN plan_started_at IS NULL THEN now() ELSE plan_started_at END,
             trial_expires_at = NULL
         WHERE email = $1
         RETURNING id, email, plan`,
        [email]
      );
      console.log('✅ User updated to Premium plan!');
      console.log(`   ID: ${result.rows[0].id}`);
      console.log(`   Email: ${result.rows[0].email}`);
      console.log(`   Plan: ${result.rows[0].plan}`);
    }

    await pool.end();
    process.exit(0);
  } catch (err) {
    console.error('❌ Error:', err.message);
    await pool.end();
    process.exit(1);
  }
}

setPremium();

