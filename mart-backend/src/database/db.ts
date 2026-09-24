import { Pool } from 'pg';
import { config } from '../config';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required. Configure mart-backend/.env.local for local development.');

const databaseHost = new URL(databaseUrl).hostname;
const localDatabaseHosts = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);
if (config.env !== 'production' && !localDatabaseHosts.has(databaseHost) && process.env.ALLOW_REMOTE_DATABASE !== 'true') {
  throw new Error(`Refusing to connect local development to remote database host ${databaseHost}. Use a local database or explicitly set ALLOW_REMOTE_DATABASE=true.`);
}

const pool = new Pool({
  connectionString: databaseUrl,
  ssl: config.env === 'production' ? { rejectUnauthorized: false } : false,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

export const query = async <T = any>(text: string, params?: unknown[]): Promise<{ rows: T[] }> => {
  const client = await pool.connect();
  try {
    const result = await client.query(text, params);
    return result;
  } finally {
    client.release();
  }
};

export const transaction = async <T>(fn: (client: any) => Promise<T>): Promise<T> => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

export default pool;
