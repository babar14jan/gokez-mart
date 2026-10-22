import app from './app';
import { config } from './config';
import { runMigrations } from './database/migrate';
import pool from './database/db';
import { installShutdownHandlers } from './utils/shutdown';

async function start() {
  // Run migrations before starting the server
  await runMigrations();

  const server = app.listen(config.port, () => {
    console.log(`🛒 Gokez Mart API running on port ${config.port}`);
    console.log(`   Health: http://localhost:${config.port}/api/v1/health`);
  });

  // The hosting platform sends SIGTERM on every deploy and restart. Without a
  // handler the process dies mid-request and the database pool is abandoned;
  // this drains the in-flight work first. See utils/shutdown.ts.
  installShutdownHandlers({ server, pool });
}

start().catch(err => {
  console.error('Failed to start:', err);
  process.exit(1);
});
