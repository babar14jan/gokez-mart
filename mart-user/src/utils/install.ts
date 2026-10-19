import { useEffect, useState } from 'react';

// Set by InstallPrompt when the browser fires `appinstalled`. Kept here (and
// re-exported) so the storage key has exactly one definition across the app.
export const INSTALLED_KEY = 'mart_install_done';

export type MobilePlatform = 'ios' | 'android';

/**
 * The install guide is a phone screenshot, so Android/iOS pick their own image.
 * Android is matched first because some Android tablets include "iPad"-like
 * tokens; iPadOS 13+ reports a desktop "Macintosh" UA and is caught via its
 * multi-touch capability check rather than the user agent. A desktop browser
 * returns null and falls back to the Android guide (the card shows everywhere
 * until the app is installed).
 */
export function detectPlatform(): MobilePlatform | null {
  if (typeof navigator === 'undefined') return null;
  const ua = navigator.userAgent || '';
  if (/android/i.test(ua)) return 'android';
  const iPadOs = /macintosh/i.test(ua) && typeof navigator.maxTouchPoints === 'number' && navigator.maxTouchPoints > 1;
  if (/iphone|ipod|ipad/i.test(ua) || iPadOs) return 'ios';
  return null;
}

/**
 * True when the page is running as an installed app rather than in a browser
 * tab. Covers the iOS Safari flag, the standard `display-mode` media query, and
 * `minimal-ui` (some launchers report that instead of `standalone`).
 */
export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  const iosStandalone = (navigator as Navigator & { standalone?: boolean }).standalone === true;
  const media = typeof window.matchMedia === 'function';
  const standalone = media && window.matchMedia('(display-mode: standalone)').matches;
  const minimalUi = media && window.matchMedia('(display-mode: minimal-ui)').matches;
  return iosStandalone || standalone || minimalUi;
}

export type DevicePlatform = 'ios' | 'android' | 'desktop' | 'other';
export type DeviceCategory = 'mobile' | 'tablet' | 'desktop';

export interface DeviceInfo {
  platform: DevicePlatform;
  deviceCategory: DeviceCategory;
  browser: string;
  isPwa: boolean;
}

/** Coarse browser family from the user agent. Not a version, by design. */
function detectBrowser(ua: string): string {
  if (/edg\//i.test(ua)) return 'edge';
  if (/opr\/|opera/i.test(ua)) return 'opera';
  if (/chrome|crios/i.test(ua)) return 'chrome';
  if (/firefox|fxios/i.test(ua)) return 'firefox';
  if (/safari/i.test(ua)) return 'safari';
  return 'other';
}

/**
 * Device facts attached to every funnel event so the journey can be sliced by
 * OS / device class / browser / installed-app without any third-party script.
 * Deliberately coarse and non-identifying: no model, no version, no fingerprint.
 */
export function getDeviceInfo(): DeviceInfo {
  if (typeof navigator === 'undefined') {
    return { platform: 'other', deviceCategory: 'desktop', browser: 'other', isPwa: false };
  }
  const ua = navigator.userAgent || '';
  const iPadOs = /macintosh/i.test(ua) && typeof navigator.maxTouchPoints === 'number' && navigator.maxTouchPoints > 1;
  const isIos = /iphone|ipod|ipad/i.test(ua) || iPadOs;
  const isAndroid = /android/i.test(ua);
  const platform: DevicePlatform = isAndroid ? 'android' : isIos ? 'ios'
    : /windows|macintosh|linux|cros/i.test(ua) ? 'desktop' : 'other';
  const deviceCategory: DeviceCategory = (/ipad|tablet/i.test(ua) || iPadOs) ? 'tablet'
    : /mobile|iphone|ipod|android/i.test(ua) ? 'mobile' : 'desktop';
  return { platform, deviceCategory, browser: detectBrowser(ua), isPwa: isStandalone() };
}

export function isAppInstalled(): boolean {
  if (isStandalone()) return true;
  try {
    return localStorage.getItem(INSTALLED_KEY) === '1';
  } catch {
    return false;
  }
}

export interface InstallGuide {
  /** Show the card while the app is not installed. */
  visible: boolean;
  /** 'ios'/'android' on a phone, null on desktop. */
  platform: MobilePlatform | null;
  guideSrc: string;
}

function compute(): InstallGuide {
  const platform = detectPlatform();
  return {
    visible: !isAppInstalled(),
    platform,
    guideSrc: platform === 'ios' ? '/iphone.webp' : '/android.webp',
  };
}

/**
 * Tracks whether the "add to home screen" guide should be offered. Re-evaluates
 * when the app is installed mid-session (InstallPrompt emits `gokez:pwa-installed`)
 * or when the display mode flips, so the card disappears the moment it applies.
 */
export function useInstallGuide(): InstallGuide {
  const [state, setState] = useState<InstallGuide>(compute);

  useEffect(() => {
    const refresh = () => setState(compute());
    window.addEventListener('gokez:pwa-installed', refresh);
    window.addEventListener('appinstalled', refresh);

    let media: MediaQueryList | null = null;
    if (typeof window.matchMedia === 'function') {
      media = window.matchMedia('(display-mode: standalone)');
      media.addEventListener?.('change', refresh);
    }

    return () => {
      window.removeEventListener('gokez:pwa-installed', refresh);
      window.removeEventListener('appinstalled', refresh);
      media?.removeEventListener?.('change', refresh);
    };
  }, []);

  return state;
}
