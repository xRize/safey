import { Pool } from 'pg';
import { runMigrations } from './migrations.js';

// Parse DATABASE_URL or use defaults with proper format
function getDbConfig() {
  const dbUrl = process.env.DATABASE_URL;
  
  if (dbUrl && dbUrl.includes('://')) {
    // Full connection string provided
    return {
      connectionString: dbUrl,
      ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : false
    };
  }
  
  // Fallback: build connection string from components or use defaults
  const user = process.env.DB_USER || 'smarttrust_user';
  const password = process.env.DB_PASSWORD || 'smarttrust_pass';
  const host = process.env.DB_HOST || 'localhost';
  const port = process.env.DB_PORT || '5432';
  const database = process.env.DB_NAME || 'smarttrust';
  
  const connectionString = `postgresql://${user}:${password}@${host}:${port}/${database}`;
  
  return {
    connectionString,
    ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : false
  };
}

const pool = new Pool(getDbConfig());

export async function initDB() {
  try {
    // Test connection
    await pool.query('SELECT NOW()');
    console.log('Database connection established');
    
    // Run migrations
    await runMigrations();
    
    return pool;
  } catch (err) {
    console.error('Database initialization error:', err);
    throw err;
  }
}

export { pool };

