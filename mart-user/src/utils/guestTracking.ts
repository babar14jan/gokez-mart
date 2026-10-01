/**
 * Guest order tracking tokens live in localStorage so a shopper who never logs
 * in can still see the orders they placed on this device.
 *
 * Every read is defensive: this key is user-writable and survives across app
 * versions, so a malformed or hand-edited value must degrade to "no tokens"
 * rather than throw. A throw here happens during render and, with no error
 * boundary in the tree, blanks the whole screen.
 */

const STORAGE_KEY = 'guest_tracking_tokens';
const MAX_TOKENS = 10;

export function readTrackingTokens(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((t): t is string => typeof t === 'string' && t.length > 0);
  } catch {
    // Corrupt payload, or storage blocked entirely (private mode, quota).
    return [];
  }
}

export function saveTrackingToken(token: string): void {
  try {
    const tokens = readTrackingTokens();
    if (tokens.includes(token)) return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...tokens, token].slice(-MAX_TOKENS)));
  } catch {
    // Losing the token only costs same-device history; never break checkout.
  }
}

export function clearTrackingTokens(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {}
}