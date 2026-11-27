export const BRAND_NAME = 'Gokez Mart';
export const BRAND_SLOGAN = 'Shop Local. Support Local.';
export const BRAND_DESCRIPTION =
  'Gokez Mart is an online marketplace for ordering everyday essentials from nearby stores.';
export const APP_CHROME_LIGHT = '#ADFBBD';
export const APP_CHROME_DARK = '#18191a';
export const ALWAYS_LIGHT_PATHS: readonly string[] = ['/welcome', '/permissions', '/login'];
export const WELCOME_SEEN_KEY = 'gokez_mart_welcome_seen_v1';
export const CUSTOMER_AUTH_KEY = 'mart-customer-auth';

export function isAlwaysLightRoute(pathname: string = window.location.pathname): boolean {
  return ALWAYS_LIGHT_PATHS.includes(pathname.replace(/\/+$/, '') || '/');
}

function hasCustomerSession(): boolean {
  try {
    const raw = localStorage.getItem(CUSTOMER_AUTH_KEY);
    if (!raw) return false;
    const stored = JSON.parse(raw);
    return !!(stored?.state && (stored.state.isLoggedIn === true || stored.state.token));
  } catch {
    return false;
  }
}

export function isEffectiveAlwaysLightRoute(
  pathname: string = window.location.pathname,
  search: string = window.location.search,
): boolean {
  const path = pathname.replace(/\/+$/, '') || '/';
  if (path !== '/') return isAlwaysLightRoute(path);
  if (hasCustomerSession()) return false;
  let welcomeSeen = false;
  try { welcomeSeen = localStorage.getItem(WELCOME_SEEN_KEY) === 'true'; } catch {}
  if (!welcomeSeen) return true;
  return !search;
}
// The longer brand story. Single source of truth so the About page, the app
// footer and the "What is Gokez Mart?" page never drift apart.
export const BRAND_PROMISE =
  "We bring local stores online — connecting you directly with neighbourhood vendors, no warehouses, no middlemen. Every order supports a real family business and keeps the trust they've built in your community over years.";
export const PARENT_COMPANY = 'Gokez Technologies';
export const PARENT_COMPANY_URL = 'https://gokez.com/';