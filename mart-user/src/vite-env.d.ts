/// <reference types="vite/client" />

/**
 * The id of the build this bundle was produced from.
 *
 * Injected at build time by the version plugin in vite.config.ts. It is the
 * same id written to /version.json and stamped into the service worker, so
 * the running app can tell whether it is the build the server is currently
 * serving. Without it the app can only notice a new deploy by comparing two
 * polls, which on a cold launch of an installed PWA means the customer is
 * shown a stale app for minutes.
 */
declare const __BUILD_ID__: string;
