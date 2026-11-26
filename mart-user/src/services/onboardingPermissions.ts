export const PERMISSIONS_SEEN_KEY = 'gokez_mart_permissions_seen_v1';

export type OnboardingPermissionState =
  | 'granted'
  | 'denied'
  | 'unsupported'
  | 'unavailable'
  | 'no_match'
  | 'error';

export interface LocationDetectionResult {
  status: string;
}

export interface OnboardingPermissionDeps {
  getLocationPermission: () => Promise<'granted' | 'denied' | 'prompt' | 'unsupported'>;
  detectDeliveryLocation: () => Promise<LocationDetectionResult>;
  isNativePush: () => boolean;
  requestNativePushPermission: () => Promise<boolean>;
  isPushSupported: () => boolean;
  getNotificationPermission: () => 'granted' | 'denied' | 'default' | 'unsupported';
  requestNotificationPermission: () => Promise<'granted' | 'denied' | 'default'>;
  subscribeToPush: () => Promise<boolean>;
}

export interface OnboardingPermissionOutcome {
  location: { state: OnboardingPermissionState };
  notifications: { state: OnboardingPermissionState; subscribed: boolean };
}

async function safely<T>(work: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await work();
  } catch {
    return fallback;
  }
}

async function requestLocation(deps: OnboardingPermissionDeps): Promise<OnboardingPermissionOutcome['location']> {
  const current = await safely(() => deps.getLocationPermission(), 'prompt');
  if (current === 'denied') return { state: 'denied' };

  const result = await safely(() => deps.detectDeliveryLocation(), { status: 'error' });
  switch (result.status) {
    case 'applied':
    case 'kept':
      return { state: 'granted' };
    case 'no_match':
      return { state: 'no_match' };
    case 'denied':
      return { state: 'denied' };
    case 'unavailable':
      return { state: 'unavailable' };
    case 'busy':
    case 'error':
    default:
      return { state: 'error' };
  }
}

async function requestNotifications(deps: OnboardingPermissionDeps): Promise<OnboardingPermissionOutcome['notifications']> {
  if (deps.isNativePush()) {
    const granted = await safely(() => deps.requestNativePushPermission(), false);
    return { state: granted ? 'granted' : 'denied', subscribed: granted };
  }

  if (!deps.isPushSupported()) return { state: 'unsupported', subscribed: false };

  const current = deps.getNotificationPermission();
  if (current === 'denied' || current === 'unsupported') return { state: current, subscribed: false };

  if (current === 'default') {
    const next = await safely(() => deps.requestNotificationPermission(), 'default');
    if (next !== 'granted') {
      return { state: next === 'denied' ? 'denied' : 'error', subscribed: false };
    }
  }

  const subscribed = await safely(() => deps.subscribeToPush(), false);
  return { state: 'granted', subscribed };
}

export async function requestOnboardingPermissions(deps: OnboardingPermissionDeps): Promise<OnboardingPermissionOutcome> {
  const notifications = await requestNotifications(deps);
  const location = await requestLocation(deps);
  return { location, notifications };
}
