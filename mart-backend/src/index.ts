import app from './app';
import { config } from './config';
import { runMigrations } from './database/migrate';

async function start() {
  // Run migrations before starting the server
  await runMigrations();

  app.listen(config.port, () => {
    console.log(`🛒 Gokez Mart API running on port ${config.port}`);
    console.log(`   Health: http://localhost:${config.port}/api/v1/health`);
  });
}

start().catch(err => {
  console.error('Failed to start:', err);
  process.exit(1);
});
