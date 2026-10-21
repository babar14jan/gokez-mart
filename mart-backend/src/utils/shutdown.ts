import { closeAllStreams } from './sse';

/**
 * Graceful shutdown.
 *
 * Railway sends SIGTERM on every deploy and restart, and Node's default
 * handling of SIGTERM is to terminate immediately. That drops in-flight
 * responses mid-request — a customer placing an order during a deploy can see
 * the connection die — and abandons the database pool without draining it.
 *
 * The sequence below is ordered so each step unblocks the next:
 *
 *   1. End the open SSE streams. A stream never finishes on its own, so
 *      while one is open `server.close()` would wait for it forever.
 *   2. `server.close()` — stop accepting new connections and let the
 *      in-flight requests finish.
 *   3. `pool.end()` — close the database connections cleanly.
 *   4. Exit.
 *
 * Every step is bounded. A client that will not finish its request, or a
 * database that will not close, must not be able to keep the process alive
 * forever: a shutdown that hangs is a deploy that never completes and a
 * container that has to be killed.
 *
 * On Railway this only runs at all if the service sets
 * RAILWAY_DEPLOYMENT_DRAINING_SECONDS — the platform's default is zero
 * seconds, which means the old container is SIGKILLed the instant it is
 * sent SIGTERM and none of the work below gets a chance to happen.
 */

/**
 * How long in-flight requests are given to finish.
 *
 * This has to fit inside the window the platform allows between SIGTERM and
 * SIGKILL. Railway sends SIGTERM to the old container and then, by default,
 * gives it **zero** seconds before force-killing it. That window is set with
 * the RAILWAY_DEPLOYMENT_DRAINING_SECONDS service variable, so this budget is
 * deliberately well under the ten seconds that setting is normally given:
 * the process must be down on its own, not waiting for the platform to kill
 * it, or the graceful path never completes and the deploy is no cleaner than
 * it was before.
 */
export const DEFAULT_GRACE_MS = 8_000;

/** The shape of the bits of Node's HTTP server this module needs. */
export interface ShutdownServer {
  close(callback?: (error?: Error) => void): unknown;
}

/** The shape of the bits of the pg Pool this module needs. */
export interface ShutdownPool {
  end(): Promise<void>;
}

export interface ShutdownOptions {
  /** The HTTP server to stop accepting on. */
  server?: ShutdownServer;
  /** The database pool to close. */
  pool?: ShutdownPool;
  /** How long the whole shutdown may take before the process is forced down. */
  graceMs?: number;
  /** How long to wait for the server to close before giving up on it. */
  serverCloseMs?: number;
  /** Overridable so tests can observe the exit instead of ending the process. */
  exit?: (code: number) => void;
  /** Overridable so tests can capture the log lines. */
  logger?: (message: string) => void;
}

const defaultLog = (message: string) => console.log(`[shutdown] ${message}`);

let shuttingDown = false;

/**
 * Stop the process cleanly.
 *
 * Safe to call more than once: a second call while the first is still
 * running is ignored, because the first one owns the exit.
 */
export async function shutdown(options: ShutdownOptions = {}): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;

  const {
    server,
    pool,
    graceMs = DEFAULT_GRACE_MS,
    serverCloseMs = Math.max(1000, Math.floor(graceMs / 2)),
    exit = (code: number) => process.exit(code),
    logger = defaultLog,
  } = options;

  // The whole shutdown is on a clock. If anything below stalls, the process
  // still goes down, which is what a deploy needs. The timer is deliberately
  // NOT unref'd: it has to keep the event loop alive long enough to fire,
  // otherwise a shutdown stuck on a hung database would simply let Node exit
  // on its own without ever reporting that it had to be forced.
  const forceTimer = setTimeout(() => {
    logger('grace period expired, exiting now');
    exit(1);
  }, graceMs);

  try {
    // 1. SSE streams. These never finish on their own and would keep
    //    server.close() waiting.
    const closedStreams = closeAllStreams();
    if (closedStreams > 0) logger(`closed ${closedStreams} event stream(s)`);

    // 2. Stop accepting and let the in-flight requests finish.
    if (server) {
      await new Promise<void>((resolve) => {
        let settled = false;
        const finish = () => {
          if (settled) return;
          settled = true;
          resolve();
        };
        const closeTimer = setTimeout(() => {
          logger('server did not close in time, continuing');
          finish();
        }, serverCloseMs);
        try {
          server.close(() => {
            clearTimeout(closeTimer);
            finish();
          });
        } catch {
          clearTimeout(closeTimer);
          finish();
        }
      });
    }

    // 3. Close the database connections.
    if (pool) {
      try {
        await pool.end();
      } catch (error) {
        logger(`pool close failed: ${(error as Error)?.message ?? error}`);
      }
    }

    clearTimeout(forceTimer);
    logger('shutdown complete');
    exit(0);
  } catch (error) {
    clearTimeout(forceTimer);
    logger(`shutdown failed: ${(error as Error)?.message ?? error}`);
    exit(1);
  }
}

/**
 * Handle SIGTERM and SIGINT by shutting down cleanly.
 *
 * A second signal exits immediately: an operator who sends SIGINT twice
 * wants it gone now, and a hung shutdown should never trap the process.
 *
 * Returns a function that removes the handlers again, which is what the
 * tests use.
 */
export function installShutdownHandlers(options: ShutdownOptions = {}): () => void {
  const exit = options.exit ?? ((code: number) => process.exit(code));
  let signalled = false;

  const onSignal = (signal: NodeJS.Signals) => {
    if (signalled) {
      // The operator asked twice. Do not wait for a graceful close.
      exit(1);
      return;
    }
    signalled = true;
    (options.logger ?? defaultLog)(`received ${signal}, shutting down`);
    void shutdown(options);
  };

  const onTerm = () => onSignal('SIGTERM');
  const onInt = () => onSignal('SIGINT');

  process.on('SIGTERM', onTerm);
  process.on('SIGINT', onInt);

  return () => {
    process.removeListener('SIGTERM', onTerm);
    process.removeListener('SIGINT', onInt);
  };
}

/** Test hook: allows a fresh shutdown to be started within one process. */
export function resetShutdownState(): void {
  shuttingDown = false;
}
