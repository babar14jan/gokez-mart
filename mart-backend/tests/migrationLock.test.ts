/**
 * Migration runner safety.
 *
 * Railway overlaps the old and the new container during a deploy, so two
 * instances of the API can boot at the same moment and both try to apply the
 * same pending migration. The second one used to fail with a duplicate key on
 * mart_migrations.filename, which threw out of the boot and left the
 * container crash-looping on a deploy that had nothing wrong with it.
 *
 * The runner now takes a transaction-scoped advisory lock, repeats the
 * "has this already been applied" check under that lock, and records the
 * migration in the same transaction as the migration itself.
 *
 * Harness matches tests/homeSections.test.ts: Node's `node:test` via `tsx`,
 * with `pg.Pool.prototype.connect` stubbed so the real SQL is captured and no
 * database is needed.
 */

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = process.env.DATABASE_URL
  || 'postgresql://postgres:postgres@localhost:5433/gokez_mart_test';
process.env.MART_JWT_SECRET = 'migration-lock-test-secret';

const require = createRequire(__filename);

interface Call { text: string; params: unknown[] }

const MIGRATIONS_DIR = path.resolve(__dirname, '../src/database/migrations');
const MIGRATION_FILES = fs.readdirSync(MIGRATIONS_DIR)
  .filter((f: string) => f.endsWith('.sql'))
  .sort();

let calls: Call[] = [];
/** Filenames the stubbed database already holds. */
let alreadyApplied = new Set<string>();
/** How many migration statements to let through before failing one. */
let failAfter = Infinity;

const pg = require('pg');
(pg.Pool.prototype as any).connect = async function () {
  return {
    query: async (text: string, params: unknown[] = []) => {
      calls.push({ text, params });
      if (/pg_advisory_xact_lock/.test(text)) return { rows: [{ pg_advisory_xact_lock: null }] };
      if (/SELECT 1 FROM mart_migrations WHERE filename/.test(text)) {
        return { rows: alreadyApplied.has(String(params[0])) ? [{ '?column?': 1 }] : [] };
      }
      if (/INSERT INTO mart_migrations/.test(text)) return { rows: [] };
      if (/CREATE TABLE IF NOT EXISTS mart_migrations/.test(text)) return { rows: [] };
      // Only a migration statement counts. The transaction control statements
      // (BEGIN, COMMIT, ROLLBACK) and the lock are not the migration, and
      // failing on one of those would make the test depend on statement order
      // rather than on the migration.
      if (!/^(BEGIN|COMMIT|ROLLBACK)\s*$/i.test(text.trim())) {
        if (failAfter-- <= 0) throw new Error('migration failed');
      }
      return { rows: [] };
    },
    release: () => undefined,
    end: async () => undefined,
  };
};

const textOf = (call: Call) => call.text.replace(/\s+/g, ' ').trim();
const indexOf = (pattern: RegExp) => calls.findIndex(c => pattern.test(c.text));

describe('migration runner', () => {
  beforeEach(() => {
    calls = [];
    alreadyApplied = new Set();
    failAfter = Infinity;
  });

  test('it takes the advisory lock before deciding whether a migration is needed', async () => {
    const { runMigrations } = await import('../src/database/migrate');
    await runMigrations();

    const lock = indexOf(/pg_advisory_xact_lock/);
    const check = indexOf(/SELECT 1 FROM mart_migrations WHERE filename/);
    assert.ok(lock >= 0, 'the migration run must take the advisory lock');
    assert.ok(check >= 0, 'the applied check must still happen');
    assert.ok(
      lock < check,
      'the lock must be taken before the applied check, or two instances can both decide to apply',
    );
  });

  test('the applied check happens under the lock, for every migration', async () => {
    const { runMigrations } = await import('../src/database/migrate');
    await runMigrations();

    const locks = calls.filter(c => /pg_advisory_xact_lock/.test(c.text)).length;
    const checks = calls.filter(c => /SELECT 1 FROM mart_migrations WHERE filename/.test(c.text)).length;
    assert.ok(checks > 0, 'the applied check must still happen');
    assert.equal(
      locks,
      checks,
      'every applied check must be under its own lock',
    );
  });

  test('a migration another instance already applied is not applied again', async () => {
    const first = MIGRATION_FILES[0];
    alreadyApplied = new Set([first]);
    const { runMigrations } = await import('../src/database/migrate');
    await runMigrations();

    // The migration that was already applied is skipped: no insert for it, and
    // its statement is never run.
    const inserts = calls.filter(c => /INSERT INTO mart_migrations/.test(c.text));
    assert.equal(
      inserts.length,
      MIGRATION_FILES.length - 1,
      'only the migrations that were not applied should be recorded',
    );
  });

  test('a migration is applied and recorded in the same transaction', async () => {
    const { runMigrations } = await import('../src/database/migrate');
    await runMigrations();

    // BEGIN / COMMIT bracket the lock, the check, the migration and the record.
    const begin = calls.findIndex(c => /^BEGIN/.test(textOf(c)));
    const commit = calls.findIndex(c => /^COMMIT/.test(textOf(c)));
    assert.ok(begin >= 0, 'a migration must run inside a transaction');
    assert.ok(commit > begin, 'the transaction must be committed');

    // The record is written before the transaction ends, so a migration can
    // never be applied without being recorded.
    const insert = calls.findIndex(c => /INSERT INTO mart_migrations/.test(c.text));
    assert.ok(insert >= 0, 'the migration must be recorded');
    assert.ok(
      insert < commit,
      'the record must be written inside the transaction, not after it',
    );
  });

  test('the record tolerates a row another instance wrote first', async () => {
    const { runMigrations } = await import('../src/database/migrate');
    await runMigrations();
    const insert = calls.find(c => /INSERT INTO mart_migrations/.test(c.text));
    assert.ok(insert, 'the migration must be recorded');
    assert.match(
      textOf(insert!),
      /ON CONFLICT \(filename\) DO NOTHING/,
      'the record must tolerate a row written by another instance',
    );
  });

  test('a failed migration rolls the transaction back and stops the run', async () => {
    // Fail the second migration statement, so the first one has already been
    // applied and committed.
    failAfter = 1;
    const { runMigrations } = await import('../src/database/migrate');

    await assert.rejects(() => runMigrations(), /migration failed/);

    // The transaction that failed must have been rolled back, and no commit
    // may follow it for that transaction.
    const rollback = calls.findIndex(c => /^ROLLBACK/.test(textOf(c)));
    assert.ok(rollback >= 0, 'a failed migration must roll back its transaction');
    const commitAfter = calls.findIndex(
      (c, i) => i > rollback && /^COMMIT/.test(textOf(c)),
    );
    assert.equal(
      commitAfter,
      -1,
      'a rolled back transaction must not be committed',
    );
  });
});
