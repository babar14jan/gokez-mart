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
 * Applies title, description, canonical and robots directives for a view.
 * Safe to call on every view change; idempotent for a given view.
 *
 * When the checkout overlay is open it takes precedence, because the address form
 * and the cart contents are what is on screen at that moment.
 */
export function applySeo(view: SeoView, opts: { checkoutActive?: boolean } = {}) {
  if (typeof document === 'undefined') return;

  const route = (opts.checkoutActive ? ROUTES.checkout : ROUTES[view]) || ROUTES.home;

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
  setAttr('meta[name="robots"]', 'content', route.indexable ? 'index, follow' : 'noindex, nofollow');

  // A canonical is only emitted for real, crawlable documents. Inventing one for
  // /account or /checkout would point a canonical at a page that should not be
  // indexed at all, so those routes keep the root canonical from index.html.
  if (route.path !== null) {
    setAttr('link[rel="canonical"]', 'href', `${SITE_ORIGIN}${route.path === '/' ? '' : route.path}`);
    setAttr('meta[property="og:url"]', 'content', `${SITE_ORIGIN}${route.path === '/' ? '' : route.path}`);
  } else {
    setAttr('link[rel="canonical"]', 'href', `${SITE_ORIGIN}/`);
    setAttr('meta[property="og:url"]', 'content', `${SITE_ORIGIN}/`);
  }
}

/** Exported for tests and for the sitemap, so both read from one source. */
export const indexableRoutes = (Object.keys(ROUTES) as SeoView[]).filter(v => ROUTES[v].indexable);
