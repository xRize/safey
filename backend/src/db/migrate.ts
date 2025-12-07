import dotenv from 'dotenv';
import { runMigrations } from './migrations.js';

// Load environment variables
dotenv.config();

async function migrate() {
  try {
    console.log('Running database migrations...');
    await runMigrations();
    console.log('✅ Migrations completed successfully');
    process.exit(0);
  } catch (err: any) {
    console.error('❌ Migration failed:', err.message);
    console.error(err);
    process.exit(1);
  }
}

migrate();
