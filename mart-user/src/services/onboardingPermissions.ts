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
  isNotificationSupported: () => boolean;
  isPushSupported: () => boolean;
  getNotificationPermission: () => 'granted' | 'denied' | 'default' | 'unsupported';
  requestNotificationPermission: () => Promise<'granted' | 'denied' | 'default'>;
  subscribeToPush: () => Promise<boolean>;
  enablePromotionalNotifications: () => Promise<boolean>;
}

export interface OnboardingPermissionOutcome {
  location: { state: OnboardingPermissionState };
  notifications: { state: OnboardingPermissionState; subscribed: boolean; promotional: boolean };
}

const PERMISSION_QUERY_TIMEOUT_MS = 2500;
const LOCATION_DETECTION_TIMEOUT_MS = 8000;
const PUSH_WORK_TIMEOUT_MS = 8000;
const PUSH_RETRY_DELAY_MS = 700;

function withDeadline<T>(work: () => Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error('timed out'));
    }, ms);
    try {
      Promise.resolve(work()).then((value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      }, (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(error);
      });
    } catch (error) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    }
  });
}

async function safely<T>(work: () => Promise<T>, fallback: T, timeoutMs?: number): Promise<T> {
  try {
    return await (timeoutMs === undefined ? work() : withDeadline(work, timeoutMs));
  } catch {
    return fallback;
  }
}

async function retryOnce<T>(
  work: () => Promise<T>,
  fallback: T,
  isSuccess: (value: T) => boolean,
): Promise<T> {
  let value = await safely(work, fallback, PUSH_WORK_TIMEOUT_MS);
  if (!isSuccess(value)) {
    await new Promise(resolve => setTimeout(resolve, PUSH_RETRY_DELAY_MS));
    value = await safely(work, fallback, PUSH_WORK_TIMEOUT_MS);
  }
  return value;
}

async function requestLocation(deps: OnboardingPermissionDeps): Promise<OnboardingPermissionOutcome['location']> {
  const current = await safely(() => deps.getLocationPermission(), 'prompt', PERMISSION_QUERY_TIMEOUT_MS);
  if (current === 'denied') return { state: 'denied' };

  const result = await safely(() => deps.detectDeliveryLocation(), { status: 'error' }, LOCATION_DETECTION_TIMEOUT_MS);
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

async function requestNotifications(deps: OnboardingPermissionDeps): Promise<Omit<OnboardingPermissionOutcome['notifications'], 'promotional'>> {
  if (deps.isNativePush()) {
    const granted = await retryOnce(() => deps.requestNativePushPermission(), false, Boolean);
    return { state: granted ? 'granted' : 'denied', subscribed: granted };
  }

  if (!deps.isNotificationSupported()) return { state: 'unsupported', subscribed: false };

  const current = deps.getNotificationPermission();
  if (current === 'denied' || current === 'unsupported') return { state: current, subscribed: false };

  if (current === 'default') {
    const next = await safely(() => deps.requestNotificationPermission(), 'default', PUSH_WORK_TIMEOUT_MS);
    if (next !== 'granted') {
      return { state: next === 'denied' ? 'denied' : 'error', subscribed: false };
    }
  }

  if (!deps.isPushSupported()) return { state: 'granted', subscribed: false };

  const subscribed = await retryOnce(() => deps.subscribeToPush(), false, Boolean);
  return { state: 'granted', subscribed };
}

export async function requestOnboardingPermissions(deps: OnboardingPermissionDeps): Promise<OnboardingPermissionOutcome> {
  const [notifications, location, promotional] = await Promise.all([
    requestNotifications(deps),
    requestLocation(deps),
    safely(() => deps.enablePromotionalNotifications(), false, PUSH_WORK_TIMEOUT_MS),
  ]);
  return { location, notifications: { ...notifications, promotional } };
}

export function startOnboardingPermissions(deps: OnboardingPermissionDeps): void {
  void requestOnboardingPermissions(deps).catch(() => {});
}
