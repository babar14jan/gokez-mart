import type { Response } from 'express';

/**
 * The set of live Server-Sent Event responses.
 *
 * An SSE stream is an open HTTP response that never ends by itself, so it
 * holds the connection open indefinitely. That is exactly what stops
 * `server.close()` from ever completing during a shutdown: Node waits for
 * every in-flight request to finish, and a stream never finishes.
 *
 * So the streams are tracked here and ended explicitly when the process is
 * asked to stop. The registry is a module-level singleton on purpose — the
 * controller that opens a stream and the shutdown path that ends them must
 * see the same set.
 */
const openStreams = new Set<Response>();

/**
 * Track a live stream.
 *
 * Returns a function that stops tracking it. Call it when the stream closes
 * for any reason, so a client that disconnects does not leave a dead
 * response in the set.
 */
export function trackStream(res: Response): () => void {
  openStreams.add(res);
  return () => {
    openStreams.delete(res);
  };
}

/**
 * End every open stream.
 *
 * Returns how many were closed. Ending the response makes Node's HTTP server
 * consider that request finished, which is what lets `server.close()`
 * complete. Ending is safe to do more than once, so a stream that is already
 * closing does not throw.
 */
export function closeAllStreams(): number {
  const count = openStreams.size;
  for (const res of openStreams) {
    try {
      res.end();
    } catch {
      // The client is already gone. Nothing to do: the request is finished
      // either way, which is all the shutdown needs.
    }
  }
  openStreams.clear();
  return count;
}

/** How many streams are currently open. Used by the shutdown path and tests. */
export function openStreamCount(): number {
  return openStreams.size;
}
