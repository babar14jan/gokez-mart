// Per-route <head> metadata for the customer SPA.
//
// The site is a single index.html, so every route shares one set of head tags by
// default. Without this, a crawler that renders JavaScript sees the homepage
// title, description and canonical on /account, /privacy, /terms and everything
// else. That is a duplicate-metadata and wrong-canonical problem, and it is the
// reason the private views get an explicit noindex rather than relying on
// robots.txt (which only stops crawling, not indexing of discovered URLs).
//
// Deliberately dependency-free and additive: it only sets attributes that already
// exist in index.html, so nothing here depends on a new library or a router
// change. robots.txt, manifest.json and the PWA start_url are untouched.

const SITE_ORIGIN = 'https://mart.gokez.com';
const BRAND = 'Gokez MART';
const SLOGAN = 'Shop Local. Support Local.';

// Matches the `View` union in App.tsx. Only the five public views are indexable;
// everything else in this app is an authenticated or transactional surface.
export type SeoView =
  | 'home' | 'categories' | 'grievance' | 'feedback' | 'privacy' | 'terms'
  | 'notification-settings' | 'delete-account' | 'account' | 'orders' | 'checkout';

interface RouteMeta {
  title: string;
  description: string;
  // Path is the canonical URL, always absolute. Null means "use the SPA root",
  // which is correct for views that are not distinct crawlable documents.
  path: string | null;
  indexable: boolean;
}

const HOME_DESCRIPTION =
  'Gokez MART connects you with nearby local stores. Shop from neighbourhood vendors, support local businesses, and order from the stores around you in Kolkata.';

const ROUTES: Record<SeoView, RouteMeta> = {
  home: {
    title: `${BRAND} | ${SLOGAN}`,
    description: HOME_DESCRIPTION,
    path: '/',
    indexable: true,
  },
  privacy: {
    title: `Privacy Policy | ${BRAND}`,
    description: `How ${BRAND} collects, uses and protects your personal data when you shop with local stores on ${SITE_ORIGIN.replace('https://', '')}.`,
    path: '/privacy',
    indexable: true,
  },
  terms: {
    title: `Terms of Service | ${BRAND}`,
    description: `The terms that apply when you use ${BRAND}, the platform operated by Gokez Technologies Pvt. Ltd. that connects you with local stores.`,
    path: '/terms',
    indexable: true,
  },
  grievance: {
    title: `Grievance Redressal | ${BRAND}`,
    description: `Raise a grievance with ${BRAND} about an order, delivery or store, and track the response from the company that operates the platform.`,
    path: '/grievance',
    indexable: true,
  },
  feedback: {
    title: `Feedback | ${BRAND}`,
    description: `Tell ${BRAND} about your shopping or delivery experience, so the platform connecting you with local stores can be improved.`,
    path: '/feedback',
    indexable: true,
  },

  // ── Not indexable ────────────────────────────────────────────────────────────
  // These views are reachable without a login but are not documents anyone should
  // land on from a search result. They are also deliberately absent from
  // sitemap.xml.
  categories: {
    title: `Browse Stores | ${BRAND}`,
    description: `Browse products available from local stores on ${BRAND}.`,
    path: null,
    indexable: false,
  },
  orders: {
    title: `Your Orders | ${BRAND}`,
    description: `Your ${BRAND} order history.`,
    path: null,
    indexable: false,
  },
  account: {
    title: `Your Account | ${BRAND}`,
    description: `Manage your ${BRAND} profile, addresses and notifications.`,
    path: null,
    indexable: false,
  },
  'notification-settings': {
    title: `Notification Settings | ${BRAND}`,
    description: `Choose how ${BRAND} notifies you about orders and offers.`,
    path: null,
    indexable: false,
  },
  'delete-account': {
    title: `Delete Account | ${BRAND}`,
    description: `Request deletion of your ${BRAND} account and personal data.`,
    path: null,
    indexable: false,
  },
  checkout: {
    title: `Checkout | ${BRAND}`,
    description: `Complete your ${BRAND} order.`,
    path: null,
    indexable: false,
  },
};

function setAttr(selector: string, attr: string, value: string) {
  const el = document.head.querySelector(selector);
  // Every tag this touches is authored in index.html. If one is ever removed
  // there, fail quietly rather than throw during render.
  if (el) el.setAttribute(attr, value);
}

/**
 * Builds an absolute URL for a route path.
 *
 * The homepage keeps its trailing slash so this stays byte-identical to the
 * canonical and og:url authored in index.html and to the <loc> in
 * sitemap.xml. Both forms return 200 with no redirect, so a mismatch here
 * would hand Google two conflicting canonicals for the same page depending on
 * whether it read the raw HTML or the rendered DOM.
 */
const absoluteUrl = (path: string): string =>
  `${SITE_ORIGIN}${path === '/' ? '/' : path}`;

/** Collapses a pathname to its canonical form for comparison purposes. */
const normalizePath = (pathname: string): string => {
  const trimmed = (pathname || '').replace(/\/+$/, '');
  return trimmed === '' ? '/' : trimmed;
};

/**
 * The only paths that may ever be indexed. Derived from ROUTES so there is a
 * single source of truth. Any other pathname on this origin is a private or
 * transactional surface, even if the app happens to be showing the home view
 * there (App.tsx maps unknown paths to 'home'), and is marked noindex so it is
 * never indexed as a bare shell of the homepage.
 */
const PUBLIC_PATHS = new Set(
  (Object.values(ROUTES) as RouteMeta[])
    .filter(route => route.indexable && route.path !== null)
    .map(route => normalizePath(route.path as string)),
);

/** The path currently in the address bar, normalised. */
const currentPath = (): string => {
  if (typeof window === 'undefined') return '/';
  return normalizePath(window.location.pathname);
};

/**
 * Applies title, description, canonical and robots directives for a view.
 * Safe to call on every view change; idempotent for a given view.
 *
 * When the checkout overlay is open it takes precedence, because the address form
 * and the cart contents are what is on screen at that moment.
 */
export function applySeo(view: SeoView, opts: { checkoutActive?: boolean } = {}) {
  if (typeof document === 'undefined') return;

  const route = (opts.checkoutActive ? ROUTES.checkout : ROUTES[view]) || ROUTES.home;

  // A route is indexable only if its own metadata says so *and* the address bar
  // is actually on a public path. The second condition is what stops /orders,
  // /categories and /checkout — which App.tsx renders as the home view — from
  // being served with `index, follow`.
  const indexable = route.indexable && PUBLIC_PATHS.has(currentPath());

  document.title = route.title;

  setAttr('meta[name="description"]', 'content', route.description);
  setAttr('meta[property="og:title"]', 'content', route.title);
  setAttr('meta[property="og:description"]', 'content', route.description);
  setAttr('meta[name="twitter:title"]', 'content', route.title);
  setAttr('meta[name="twitter:description"]', 'content', route.description);

  // Noindex is enforced here rather than in robots.txt: robots.txt prevents
  // crawling, which does not stop a URL that has already been discovered from
  // being indexed as a bare shell. Authentication remains the real boundary for
  // private data — this only keeps those pages out of search results.
  setAttr('meta[name="robots"]', 'content', indexable ? 'index, follow' : 'noindex, nofollow');

  // A canonical is only emitted for real, crawlable documents. Inventing one for
  // /account or /checkout would point a canonical at a page that should not be
  // indexed at all, so those routes keep the root canonical from index.html.
  const canonical = absoluteUrl(route.path ?? '/');
  setAttr('link[rel="canonical"]', 'href', canonical);
  setAttr('meta[property="og:url"]', 'content', canonical);
}

/** Exported for tests and for the sitemap, so both read from one source. */
export const indexableRoutes = (Object.keys(ROUTES) as SeoView[]).filter(v => ROUTES[v].indexable);

/** The canonical path list the sitemap must match, for the build-time guard. */
export const publicPaths = (): string[] => [...PUBLIC_PATHS].sort();

/** Exposed so the guard can assert the homepage keeps its trailing slash. */
export const canonicalFor = absoluteUrl;
