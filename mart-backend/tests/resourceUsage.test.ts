/**
 * Resource usage: the changes that keep the process's idle footprint and its
 * shutdown behaviour honest.
 *
 * Four things are locked down here, all of which are easy to break silently:
 *
 *   1. `sharp` is a native module that is only needed when an image is
 *      actually re-encoded. Importing it eagerly put ~11 MB of native
 *      bindings in the boot path of a service that is on screen all day.
 *      The test asserts it is NOT loaded when the API module is loaded.
 *   2. A graceful shutdown must end the live event streams first, because a
 *      stream never finishes on its own and would keep `server.close()`
 *      waiting forever. Then it stops the server, then closes the pool.
 *   3. The shutdown must not be able to hang. A client that will not finish,
 *      or a database that will not close, must still let the process exit.
 *   4. Every outbound HTTP call carries a timeout, so a third party that
 *      stops answering cannot pin a request, a socket and (inside a
 *      transaction) a database connection.
 *
 * Harness matches tests/homeSections.test.ts: Node's `node:test` via `tsx`,
 * with `pg.Pool.prototype.connect` stubbed so the real service SQL is
 * captured and no database is needed.
 */

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = process.env.DATABASE_URL
  || 'postgresql://postgres:postgres@localhost:5433/gokez_mart_test';
process.env.MART_JWT_SECRET = 'resource-usage-test-secret';

const require = createRequire(__filename);

// ── pg stub ──────────────────────────────────────────────────────────────────
const pg = require('pg');
(pg.Pool.prototype as any).connect = async function () {
  return {
    query: async () => ({ rows: [] }),
    release: () => undefined,
    end: async () => undefined,
  };
};

const isSharpLoaded = () =>
  Object.keys(require.cache).some((key) => /[\\/]node_modules[\\/]sharp[\\/]/.test(key));

describe('lazy image processing', () => {
  test('loading the API does not load sharp', async () => {
    // Make sure a previous test in this file has not already loaded it.
    assert.equal(isSharpLoaded(), false, 'sharp must not be in the module cache before the API is loaded');
    await import('../src/controllers/index');
    assert.equal(
      isSharpLoaded(),
      false,
      'sharp was loaded at import time. It must only be loaded when an image is actually processed, '
      + 'because it holds native bindings in memory for the life of the process.',
    );
  });

  test('the static sharp import is gone and the dynamic one is inside prepareImage', () => {
    const fs = require('fs');
    const path = require('path');
    const source = fs.readFileSync(path.resolve(__dirname, '../src/controllers/index.ts'), 'utf8');
    assert.ok(
      !/^import\s+sharp\s+from\s+'sharp';/m.test(source),
      'sharp must not be imported at the top of the module',
    );
    assert.match(
      source,
      /await import\('sharp'\)/,
      'sharp must be loaded with a dynamic import',
    );
    // The dynamic import has to be inside prepareImage, not somewhere else.
    const prepareImage = source.slice(source.indexOf('async function prepareImage'));
    const prepareImageEnd = prepareImage.indexOf('\n}\n');
    assert.match(
      prepareImage.slice(0, prepareImageEnd),
      /await import\('sharp'\)/,
      'the dynamic import must be inside prepareImage',
    );
  });
});

describe('event stream registry', () => {
  test('a tracked stream is closed and unregistered', async () => {
    const { trackStream, closeAllStreams, openStreamCount } = await import('../src/utils/sse');
    let ended = 0;
    const res: any = { end: () => { ended++; } };
    const untrack = trackStream(res);
    assert.equal(openStreamCount(), 1);
    untrack();
    assert.equal(openStreamCount(), 0, 'an untracked stream must not be left in the registry');
    assert.equal(ended, 0, 'untracking must not end the stream');
  });

  test('closing all streams ends every one of them and empties the registry', async () => {
    const { trackStream, closeAllStreams, openStreamCount } = await import('../src/utils/sse');
    const ended: number[] = [];
    trackStream({ end: () => { ended.push(1); } } as any);
    trackStream({ end: () => { ended.push(2); } } as any);
    assert.equal(openStreamCount(), 2);
    const closed = closeAllStreams();
    assert.equal(closed, 2);
    assert.equal(ended.length, 2, 'both streams must be ended');
    assert.equal(openStreamCount(), 0, 'the registry must be empty after a close');
  });

  test('ending a stream that has already gone does not throw', async () => {
    const { trackStream, closeAllStreams } = await import('../src/utils/sse');
    trackStream({ end: () => { throw new Error('client already gone'); } } as any);
    assert.doesNotThrow(() => closeAllStreams());
  });
});

describe('graceful shutdown', () => {
  beforeEach(async () => {
    const { resetShutdownState } = await import('../src/utils/shutdown');
    resetShutdownState();
  });

  test('it ends the event streams, stops the server, closes the pool, then exits', async () => {
    const { shutdown } = await import('../src/utils/shutdown');
    const { trackStream } = await import('../src/utils/sse');

    const order: string[] = [];
    let ended = 0;
    trackStream({ end: () => { ended++; } } as any);

    const server = {
      close: (cb?: (error?: Error) => void) => { order.push('server.close'); cb?.(); },
    };
    const pool = {
      end: async () => { order.push('pool.end'); },
    };

    await shutdown({
      server,
      pool,
      exit: () => { order.push('exit'); },
      logger: () => undefined,
    });

    assert.equal(ended, 1, 'the open event stream must be ended');
    assert.deepEqual(order, ['server.close', 'pool.end', 'exit']);
  });

  test('the server is closed before the pool, so no request can start a new query', async () => {
    const { shutdown } = await import('../src/utils/shutdown');
    const order: string[] = [];
    await shutdown({
      server: { close: (cb?: (error?: Error) => void) => { order.push('server'); cb?.(); } },
      pool: { end: async () => { order.push('pool'); } },
      exit: () => { order.push('exit'); },
      logger: () => undefined,
    });
    assert.deepEqual(order, ['server', 'pool', 'exit']);
  });

  test('a server that never closes does not stop the process exiting', async () => {
    const { shutdown } = await import('../src/utils/shutdown');
    let exitCode: number | null = null;
    const started = Date.now();
    await shutdown({
      // A server whose close callback is never called — a client holding a
      // request open forever.
      server: { close: () => undefined },
      pool: { end: async () => undefined },
      graceMs: 200,
      serverCloseMs: 50,
      exit: (code) => { exitCode = code; },
      logger: () => undefined,
    });
    assert.equal(exitCode, 0, 'the process must still exit');
    assert.ok(Date.now() - started < 2000, 'the shutdown must not hang');
  });

  test('the whole shutdown is bounded by the grace period', async () => {
    const { shutdown } = await import('../src/utils/shutdown');
    let exitCode: number | null = null;
    // The pool never resolves, so `shutdown` cannot finish on its own. The
    // grace timer has to bring the process down — the test waits for that
    // rather than for the shutdown promise, which never settles.
    const exited = new Promise<void>((resolve) => {
      void shutdown({
        server: { close: () => undefined },
        pool: { end: () => new Promise(() => undefined) },
        graceMs: 200,
        serverCloseMs: 50,
        exit: (code) => { exitCode = code; resolve(); },
        logger: () => undefined,
      });
    });
    await exited;
    assert.equal(exitCode, 1, 'a shutdown that stalls must be forced down');
  });

  test('a pool that fails to close still lets the process exit', async () => {
    const { shutdown } = await import('../src/utils/shutdown');
    let exitCode: number | null = null;
    await shutdown({
      pool: { end: async () => { throw new Error('pool close failed'); } },
      exit: (code) => { exitCode = code; },
      logger: () => undefined,
    });
    assert.equal(exitCode, 0);
  });

  test('calling it twice does not run the sequence twice', async () => {
    const { shutdown } = await import('../src/utils/shutdown');
    let closes = 0;
    const options = {
      server: { close: (cb?: (error?: Error) => void) => { closes++; cb?.(); } },
      exit: () => undefined,
      logger: () => undefined,
    };
    await shutdown(options);
    await shutdown(options);
    assert.equal(closes, 1, 'a second shutdown must be ignored');
  });

  test('the signal handlers are installed and can be removed again', async () => {
    const { installShutdownHandlers } = await import('../src/utils/shutdown');
    const before = process.listenerCount('SIGTERM');
    const remove = installShutdownHandlers({ exit: () => undefined });
    assert.equal(process.listenerCount('SIGTERM'), before + 1);
    assert.equal(process.listenerCount('SIGINT'), before + 1);
    remove();
    assert.equal(process.listenerCount('SIGTERM'), before);
    assert.equal(process.listenerCount('SIGINT'), before);
  });

  test('the grace period fits inside the window the platform allows', async () => {
    const { DEFAULT_GRACE_MS } = await import('../src/utils/shutdown');
    // Railway sends SIGTERM to the old container and then SIGKILLs it after
    // RAILWAY_DEPLOYMENT_DRAINING_SECONDS (zero by default). The shutdown
    // budget must be comfortably shorter than that window, or the process is
    // killed before it can finish and the graceful path never happens.
    assert.ok(
      DEFAULT_GRACE_MS < 10_000,
      `the grace period of ${DEFAULT_GRACE_MS}ms must leave room inside a ten second drain window`,
    );
    assert.ok(DEFAULT_GRACE_MS >= 3_000, 'the grace period must still allow a request to finish');
  });

  test('a shutdown completes even with an event stream still open', async () => {
    // The reason the streams are ended first. A Server-Sent Event response
    // never finishes on its own, so Node's server.close() would wait for it
    // forever and the deploy would hang until the grace period forced the
    // process down. With the stream ended, the close completes immediately.
    const { shutdown } = await import('../src/utils/shutdown');
    const { trackStream, openStreamCount } = await import('../src/utils/sse');
    const http = require('http');
    const express = require('express');

    const app = express();
    app.get('/events', (_req: any, res: any) => {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write(': connected\n\n');
      trackStream(res);
    });

    const server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const port = (server.address() as any).port;

    // Open a stream and leave it open, exactly like a hub tab would.
    const client = http.get({ host: '127.0.0.1', port, path: '/events' }, (res: any) => {
      res.on('data', () => undefined);
      res.on('end', () => undefined);
    });
    await new Promise<void>((resolve) => setTimeout(resolve, 250));
    assert.equal(openStreamCount(), 1, 'the stream should be registered while it is open');

    let exitCode: number | null = null;
    const started = Date.now();
    try {
      await shutdown({
        server: {
          close: (cb?: (error?: Error) => void) => {
            // A real server only calls back once every request has finished, so
            // the callback is deferred the way Node defers it for a live stream.
            setTimeout(() => cb?.(), 100);
          },
        },
        exit: (code) => { exitCode = code; },
        graceMs: 3000,
        logger: () => undefined,
      });
    } finally {
      // The stub above stands in for the real server, so the real one has to be
      // torn down by hand or the test process never exits.
      client.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }

    assert.equal(exitCode, 0, 'the shutdown must complete normally');
    assert.equal(openStreamCount(), 0, 'the open stream must be closed');
    assert.ok(Date.now() - started < 2500, 'the shutdown must not have hit the grace period');
  });
});

describe('request logging', () => {
  test('the production line keeps the method, path, status and response time', async () => {
    const { PRODUCTION_LOG_FORMAT } = await import('../src/utils/requestLog');
    assert.match(PRODUCTION_LOG_FORMAT, /:method/);
    assert.match(PRODUCTION_LOG_FORMAT, /:path-only/);
    assert.match(PRODUCTION_LOG_FORMAT, /:status/);
    assert.match(PRODUCTION_LOG_FORMAT, /:response-time/);
    // Nothing that could carry a secret or personal data.
    assert.ok(!PRODUCTION_LOG_FORMAT.includes(':url'), 'the raw URL carries the query string');
    assert.ok(!PRODUCTION_LOG_FORMAT.includes(':remote-addr'), 'the remote address is personal data');
    assert.ok(!PRODUCTION_LOG_FORMAT.includes(':user-agent'), 'the user agent is large and rarely needed');
    assert.ok(!PRODUCTION_LOG_FORMAT.includes(':referrer'), 'the referrer is large and rarely needed');
  });

  test('the query string never reaches the log line', async () => {
    const { installRequestLogger } = await import('../src/utils/requestLog');
    const express = require('express');
    const http = require('http');

    const app = express();
    // Capture what morgan writes. An explicit stream is used so the line is
    // written straight away — morgan buffers stdout for a second otherwise.
    const lines: string[] = [];
    installRequestLogger(app, 'production', { write: (chunk: string) => { lines.push(String(chunk)); } });

    // The logger has to come before the routes, exactly as it does in app.ts:
    // a route that has already sent its response is never logged.
    app.get('/orders/track/tokens', (_req: any, res: any) => res.json({ ok: true }));
    app.get('/health', (_req: any, res: any) => res.json({ ok: true }));

    const server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const port = (server.address() as any).port;

    const get = (path: string) => new Promise<void>((resolve) => {
      http.get({ host: '127.0.0.1', port, path }, (res: any) => {
        res.resume();
        res.on('end', () => resolve());
      });
    });

    try {
      await get('/orders/track/tokens?token=SUPERSECRETTOKEN123');
      await get('/health');
      await new Promise((resolve) => setTimeout(resolve, 100));
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }

    const logged = lines.join('');
    assert.match(logged, /GET/, 'the method must be logged');
    assert.match(logged, /\/orders\/track\/tokens/, 'the path must be logged');
    assert.match(logged, /200/, 'the status must be logged');
    assert.match(logged, /ms/, 'the response time must be logged');
    assert.ok(
      !logged.includes('SUPERSECRETTOKEN'),
      'a token from the query string must never be written to the log',
    );
    assert.ok(
      !logged.includes('token='),
      'the query string must never be written to the log',
    );
  });
});

describe('outbound timeouts', () => {
  test('every outbound call carries a timeout', () => {
    const fs = require('fs');
    const path = require('path');
    const read = (p: string) => fs.readFileSync(path.resolve(__dirname, '..', p), 'utf8');
    const controllers = read('src/controllers/index.ts');
    const customerAuth = read('src/services/customerAuth.service.ts');

    // The three outbound calls in the controllers: reverse geocoding and the
    // two storage uploads.
    const controllerFetches = controllers.match(/await fetch\(/g) || [];
    assert.equal(controllerFetches.length, 3, 'expected three outbound calls in the controllers');
    const controllerSignals = controllers.match(/signal: timeoutSignal\(/g) || [];
    assert.equal(
      controllerSignals.length,
      3,
      'every outbound call in the controllers must carry a timeout signal',
    );

    // The SMS provider on the customer sign-in path.
    assert.match(
      customerAuth,
      /await fetch\(url, \{ signal: timeoutSignal\(OUTBOUND_TIMEOUTS\.otpSms\) \}\)/,
      'the OTP provider call must carry a timeout signal',
    );
  });

  test('the limits are per endpoint and in a sane range', async () => {
    const { OUTBOUND_TIMEOUTS } = await import('../src/utils/timeouts');
    // The geocode call is optional, so it must be the tightest.
    assert.ok(
      OUTBOUND_TIMEOUTS.geocode < OUTBOUND_TIMEOUTS.storageUpload,
      'the optional geocode call must have a tighter budget than an upload',
    );
    // Signing in must not be cut short by a timeout that is too tight.
    assert.ok(
      OUTBOUND_TIMEOUTS.otpSms >= 5_000,
      'the OTP provider needs at least five seconds',
    );
    for (const [name, ms] of Object.entries(OUTBOUND_TIMEOUTS)) {
      assert.ok(ms > 0 && ms <= 30_000, `${name} timeout of ${ms}ms is out of range`);
    }
  });

  test('the signal really does abort the request', async () => {
    const { timeoutSignal } = await import('../src/utils/timeouts');
    const signal = timeoutSignal(150);
    assert.equal(signal.aborted, false);
    await new Promise((resolve) => setTimeout(resolve, 250));
    assert.equal(signal.aborted, true, 'the signal must abort once the timeout passes');
  });
});
