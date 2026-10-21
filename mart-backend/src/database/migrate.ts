import fs from 'fs';
import path from 'path';
import { query, transaction } from './db';

/**
 * The advisory lock that serialises migration runs.
 *
 * Railway overlaps the old and the new container during a deploy, so two
 * instances of the API can boot at the same moment and both try to apply the
 * same pending migration. The second one used to fail with a duplicate key on
 * mart_migrations.filename, which threw out of the boot and left the container
 * crash-looping on a deploy that had nothing wrong with it.
 *
 * The lock is transaction-scoped rather than session-scoped on purpose: a
 * session lock is unreliable behind a connection pooler in transaction mode
 * (PgBouncer and Supabase's pooler both move a transaction between backend
 * connections), and a transaction-scoped lock is released by Postgres itself
 * when the transaction ends, so a killed process cannot leave it held.
 */
const MIGRATION_LOCK_KEY = 7_314_159;

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
    // Each migration is applied in its own transaction, as it always was, and
    // the lock is taken inside it. The check for "has this already been
    // applied" is repeated under the lock, so a migration another instance is
    // applying right now is waited for rather than applied a second time.
    const applied = await transaction(async (client) => {
      await client.query('SELECT pg_advisory_xact_lock($1)', [MIGRATION_LOCK_KEY]);

      const { rows } = await client.query(
        'SELECT 1 FROM mart_migrations WHERE filename = $1',
        [file]
      );
      if (rows.length > 0) return false;

      const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
      await client.query(sql);
      // Recorded in the same transaction as the migration itself, so a
      // migration can never be applied without being recorded, or recorded
      // without being applied. ON CONFLICT covers the case where the lock
      // was not honoured (a pooler that does not pass advisory locks
      // through) and another instance recorded the row first.
      await client.query(
        'INSERT INTO mart_migrations (filename) VALUES ($1) ON CONFLICT (filename) DO NOTHING',
        [file]
      );
      return true;
    });

    if (applied) console.log(`  ✅ ${file}`);
    else console.log(`  ✓ ${file} (already applied)`);
  }

  console.log('✅ Mart migrations complete');
}

// Allow running directly: npx tsx src/database/migrate.ts
if (require.main === module) {
  runMigrations()
    .then(() => process.exit(0))
    .catch(err => { console.error('❌ Migration failed:', err); process.exit(1); });
}
