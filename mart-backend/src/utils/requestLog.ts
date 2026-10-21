import morgan from 'morgan';
import type { Application } from 'express';

/**
 * The request log.
 *
 * The production line carries only what is needed to follow a request:
 * method, path, status and how long it took. Everything the previous
 * "combined" format added was left out on purpose:
 *
 *   * the query string — order tracking tokens, phone lookups and anything
 *     else sensitive is passed there, and a URL is exactly the kind of value
 *     that ends up in a log aggregator
 *   * the remote address — personal data, and not needed to follow a request
 *   * the user agent and referrer — large, and rarely needed
 *
 * Errors keep their full diagnostics: the error handler logs the error
 * itself, separately from this line.
 */
export const PRODUCTION_LOG_FORMAT = ':method :path-only :status :response-time ms';

/**
 * The path without its query string.
 *
 * Registered as a morgan token so the format string can stay declarative.
 *
 * `stream` is optional and defaults to morgan's own behaviour (process.stdout,
 * buffered). It is injectable so the log line can be asserted on directly
 * rather than by scraping stdout.
 */
export function installRequestLogger(
  app: Application,
  env: string,
  stream?: { write(chunk: string): unknown },
): void {
  // Tests capture the log themselves; a logger would only add noise.
  if (env === 'test') return;

  morgan.token('path-only', (req) => {
    const url = (req as any).originalUrl || (req as any).url || '';
    return url.split('?')[0];
  });

  app.use(morgan(env === 'production' ? PRODUCTION_LOG_FORMAT : 'dev', stream ? { stream } : undefined));
}
