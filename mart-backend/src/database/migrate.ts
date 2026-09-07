import fs from 'fs';
import path from 'path';
import { query } from './db';

export async function runMigrations(): Promise<void> {
  console.log('🛒 Running Gokez Mart migrations...');

  await query(`
    CREATE TABLE IF NOT EXISTS mart_migrations (
      id         SERIAL PRIMARY KEY,
      filename   TEXT NOT NULL UNIQUE,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  const migrationsDir = path.join(__dirname, 'migrations');
  const files = fs.readdirSync(migrationsDir)
    .filter(f => f.endsWith('.sql'))
    .sort();

  for (const file of files) {
    const { rows } = await query(
      'SELECT 1 FROM mart_migrations WHERE filename = $1',
      [file]
    );
    if (rows.length > 0) {
      console.log(`  ✓ ${file} (already applied)`);
      continue;
    }
    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
    await query(sql);
    await query('INSERT INTO mart_migrations (filename) VALUES ($1)', [file]);
    console.log(`  ✅ ${file}`);
  }

  console.log('✅ Mart migrations complete');
}

// Allow running directly: npx tsx src/database/migrate.ts
if (require.main === module) {
  runMigrations()
    .then(() => process.exit(0))
    .catch(err => { console.error('❌ Migration failed:', err); process.exit(1); });
}
