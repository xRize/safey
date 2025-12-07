/**
 * Cleanup script to remove database entries for links that have extension markers
 * These are links that were already processed and shouldn't be in the database
 */

import pg from 'pg';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const { Pool } = pg;

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, '..');

dotenv.config({ path: join(rootDir, '.env') });

const extensionMarkerPatterns = [
  /⚠\s*Caution/i,
  /⚠️\s*Caution/i,
  /⚠\s*Safe/i,
  /⚠️\s*Safe/i,
  /⚠\s*Danger/i,
  /⚠️\s*Danger/i,
  /Trust\s*Score/i,
  /\[SAFE\]/i,
  /\[SUSPICIOUS\]/i,
  /\[DANGEROUS\]/i,
  /PHISHING\s*RISK/i,
  /SmartTrust/i
];

async function cleanupMarkedLinks() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : false
  });

  try {
    console.log('🔍 Checking for links with extension markers...');
    
    // Get all link_scans entries
    const result = await pool.query(`
      SELECT id, url, link_text 
      FROM link_scans
    `);

    const linksToDelete = [];
    
    for (const row of result.rows) {
      const linkText = row.link_text || '';
      
      // Check if link_text contains extension markers
      const hasMarker = extensionMarkerPatterns.some(pattern => 
        pattern.test(linkText)
      );
      
      if (hasMarker) {
        linksToDelete.push(row.id);
        console.log(`  Found marked link: ${row.url} (text: "${linkText.slice(0, 50)}...")`);
      }
    }

    if (linksToDelete.length === 0) {
      console.log('✅ No links with extension markers found.');
      return;
    }

    console.log(`\n🗑️  Deleting ${linksToDelete.length} entries with extension markers...`);
    
    // Delete in batches to avoid overwhelming the database
    const BATCH_SIZE = 100;
    for (let i = 0; i < linksToDelete.length; i += BATCH_SIZE) {
      const batch = linksToDelete.slice(i, i + BATCH_SIZE);
      await pool.query(`
        DELETE FROM link_scans
        WHERE id = ANY($1::uuid[])
      `, [batch]);
      
      console.log(`  Deleted batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(linksToDelete.length / BATCH_SIZE)}`);
    }

    console.log(`\n✅ Successfully deleted ${linksToDelete.length} entries with extension markers.`);
  } catch (err) {
    console.error('❌ Error cleaning up marked links:', err);
    throw err;
  } finally {
    await pool.end();
  }
}

// Run cleanup
cleanupMarkedLinks()
  .then(() => {
    console.log('\n✨ Cleanup complete!');
    process.exit(0);
  })
  .catch((err) => {
    console.error('\n❌ Cleanup failed:', err);
    process.exit(1);
  });

