import { Pool } from 'pg';

// Create a separate pool for migrations to avoid circular dependency
const getPool = () => {
  const dbUrl = process.env.DATABASE_URL;
  
  if (dbUrl && dbUrl.includes('://')) {
    // Full connection string provided
    return new Pool({
      connectionString: dbUrl,
      ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : false
    });
  }
  
  // Fallback: build connection string from components or use defaults
  const user = process.env.DB_USER || 'smarttrust_user';
  const password = process.env.DB_PASSWORD || 'smarttrust_pass';
  const host = process.env.DB_HOST || 'localhost';
  const port = process.env.DB_PORT || '5432';
  const database = process.env.DB_NAME || 'smarttrust';
  
  const connectionString = `postgresql://${user}:${password}@${host}:${port}/${database}`;
  
  return new Pool({
    connectionString,
    ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : false
  });
};

export async function runMigrations() {
  const pool = getPool();
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    // Create users table
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        email text UNIQUE NOT NULL,
        password_hash text,
        created_at timestamptz DEFAULT now(),
        plan text DEFAULT 'free' CHECK (plan IN ('free', 'trial', 'premium')),
        plan_started_at timestamptz,
        trial_expires_at timestamptz,
        stripe_customer_id text,
        stripe_subscription_id text
      )
    `);
    
    // Add password_hash column if it doesn't exist (for existing databases)
    await client.query(`
      DO $$ 
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_name='users' AND column_name='password_hash'
        ) THEN
          ALTER TABLE users ADD COLUMN password_hash text;
        END IF;
      END $$;
    `);
    
    // Create domains table
    await client.query(`
      CREATE TABLE IF NOT EXISTS domains (
        id serial PRIMARY KEY,
        domain text UNIQUE NOT NULL,
        default_enabled boolean DEFAULT true,
        created_at timestamptz DEFAULT now()
      )
    `);
    
    // Create link_scans table
    await client.query(`
      CREATE TABLE IF NOT EXISTS link_scans (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id uuid REFERENCES users(id) ON DELETE SET NULL,
        domain text NOT NULL,
        url text NOT NULL,
        link_text text,
        detected_issues jsonb DEFAULT '[]'::jsonb,
        trust_score numeric NOT NULL CHECK (trust_score >= 0 AND trust_score <= 1),
        gpt_summary text,
        ollama_analysis jsonb,
        external_checks jsonb,
        recommendation text,
        risk_tags jsonb,
        confidence numeric,
        category text CHECK (category IN ('SAFE', 'SUSPICIOUS', 'DANGEROUS')),
        created_at timestamptz DEFAULT now(),
        updated_at timestamptz DEFAULT now(),
        CONSTRAINT unique_url_recent UNIQUE (url)
      )
    `);
    
    // Add new columns if they don't exist (for existing databases)
    await client.query(`
      DO $$ 
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='link_scans' AND column_name='ollama_analysis') THEN
          ALTER TABLE link_scans ADD COLUMN ollama_analysis jsonb;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='link_scans' AND column_name='external_checks') THEN
          ALTER TABLE link_scans ADD COLUMN external_checks jsonb;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='link_scans' AND column_name='recommendation') THEN
          ALTER TABLE link_scans ADD COLUMN recommendation text;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='link_scans' AND column_name='risk_tags') THEN
          ALTER TABLE link_scans ADD COLUMN risk_tags jsonb;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='link_scans' AND column_name='confidence') THEN
          ALTER TABLE link_scans ADD COLUMN confidence numeric;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='link_scans' AND column_name='updated_at') THEN
          ALTER TABLE link_scans ADD COLUMN updated_at timestamptz DEFAULT now();
        END IF;
      END $$;
    `);
    
    // Create site_settings table
    await client.query(`
      CREATE TABLE IF NOT EXISTS site_settings (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id uuid REFERENCES users(id) ON DELETE CASCADE,
        domain text NOT NULL,
        enabled boolean DEFAULT true,
        created_at timestamptz DEFAULT now(),
        UNIQUE(user_id, domain)
      )
    `);
    
    // Create indexes for efficient lookups
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_link_scans_domain ON link_scans(domain);
      CREATE INDEX IF NOT EXISTS idx_link_scans_user_id ON link_scans(user_id);
      CREATE INDEX IF NOT EXISTS idx_link_scans_created_at ON link_scans(created_at);
      CREATE INDEX IF NOT EXISTS idx_link_scans_url ON link_scans(url);
      CREATE INDEX IF NOT EXISTS idx_link_scans_url_created ON link_scans(url, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_site_settings_user_domain ON site_settings(user_id, domain);
    `);
    
    await client.query('COMMIT');
    console.log('Migrations completed successfully');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Migration error:', err);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

