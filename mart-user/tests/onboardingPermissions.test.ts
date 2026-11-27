import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  requestOnboardingPermissions,
  type OnboardingPermissionDeps,
} from '../src/services/onboardingPermissions';

function makeDeps(overrides: Partial<OnboardingPermissionDeps> = {}) {
  const calls = {
    detect: 0,
    nativeRequest: 0,
    notificationRequest: 0,
    subscribe: 0,
    promotional: 0,
  };
  const deps: OnboardingPermissionDeps = {
    getLocationPermission: async () => 'prompt',
    detectDeliveryLocation: async () => {
      calls.detect += 1;
      return { status: 'applied' };
    },
    isNativePush: () => false,
    requestNativePushPermission: async () => {
      calls.nativeRequest += 1;
      return true;
    },
    isNotificationSupported: () => true,
    isPushSupported: () => true,
    getNotificationPermission: () => 'default',
    requestNotificationPermission: async () => {
      calls.notificationRequest += 1;
      return 'granted';
    },
    subscribeToPush: async () => {
      calls.subscribe += 1;
      return true;
    },
    enablePromotionalNotifications: async () => {
      calls.promotional += 1;
      return true;
    },
    ...overrides,
  };
  return { deps, calls };
}

describe('permissions onboarding requests', () => {
  test('granted location and granted notifications are independent', async () => {
    const { deps, calls } = makeDeps();
    const result = await requestOnboardingPermissions(deps);
    assert.deepEqual(result, {
      location: { state: 'granted' },
      notifications: { state: 'granted', subscribed: true, promotional: true },
    });
    assert.equal(calls.detect, 1);
    assert.equal(calls.notificationRequest, 1);
    assert.equal(calls.subscribe, 1);
    assert.equal(calls.promotional, 1);
  });

  test('denied location is not re-prompted and does not block notifications', async () => {
    const { deps } = makeDeps({
      getLocationPermission: async () => 'denied',
      getNotificationPermission: () => 'denied',
    });
    const result = await requestOnboardingPermissions(deps);
    assert.deepEqual(result, {
      location: { state: 'denied' },
      notifications: { state: 'denied', subscribed: false, promotional: true },
    });
  });

  test('granted notification permission skips the prompt and still subscribes', async () => {
    const { deps, calls } = makeDeps({ getNotificationPermission: () => 'granted' });
    const result = await requestOnboardingPermissions(deps);
    assert.equal(result.notifications.state, 'granted');
    assert.equal(calls.notificationRequest, 0);
    assert.equal(calls.subscribe, 1);
    assert.equal(result.notifications.promotional, true);
  });

  test('a browser with notifications but no web push still asks for notification permission', async () => {
    const { deps, calls } = makeDeps({ isPushSupported: () => false });
    const result = await requestOnboardingPermissions(deps);
    assert.equal(result.notifications.state, 'granted');
    assert.equal(calls.notificationRequest, 1);
    assert.equal(calls.subscribe, 0);
    assert.equal(result.notifications.promotional, true);
  });

  test('unsupported notifications never request a permission that cannot be shown', async () => {
    const { deps, calls } = makeDeps({
      isNotificationSupported: () => false,
      isPushSupported: () => false,
    });
    const result = await requestOnboardingPermissions(deps);
    assert.deepEqual(result, {
      location: { state: 'granted' },
      notifications: { state: 'unsupported', subscribed: false, promotional: true },
    });
    assert.equal(calls.notificationRequest, 0);
  });

  test('coordinates with no matching delivery area are not reported as denied', async () => {
    const { deps } = makeDeps({
      detectDeliveryLocation: async () => ({ status: 'no_match' }),
    });
    const result = await requestOnboardingPermissions(deps);
    assert.equal(result.location.state, 'no_match');
  });

  test('a failed location lookup does not stop the notification request', async () => {
    let notificationRequests = 0;
    const { deps, calls } = makeDeps({
      detectDeliveryLocation: async () => { throw new Error('gps failed'); },
      requestNotificationPermission: async () => {
        notificationRequests += 1;
        throw new Error('prompt failed');
      },
    });
    const result = await requestOnboardingPermissions(deps);
    assert.equal(result.location.state, 'error');
    assert.equal(result.notifications.state, 'error');
    assert.equal(notificationRequests, 1);
    assert.equal(calls.subscribe, 0);
    assert.equal(result.notifications.promotional, true);
  });

  test('native Android uses the native push service only', async () => {
    const { deps, calls } = makeDeps({ isNativePush: () => true });
    const result = await requestOnboardingPermissions(deps);
    assert.equal(result.notifications.state, 'granted');
    assert.equal(result.notifications.promotional, true);
    assert.equal(calls.nativeRequest, 1);
    assert.equal(calls.notificationRequest, 0);
    assert.equal(calls.subscribe, 0);
  });

  test('the notification prompt is not queued behind location detection', async () => {
    const order: string[] = [];
    const { deps } = makeDeps({
      detectDeliveryLocation: async () => { order.push('location'); return { status: 'applied' }; },
      requestNotificationPermission: async () => { order.push('notification'); return 'granted'; },
    });
    await requestOnboardingPermissions(deps);
    assert.equal(order[0], 'notification');
  });

  test('a denied native push result is not recorded as granted', async () => {
    const { deps } = makeDeps({
      isNativePush: () => true,
      requestNativePushPermission: async () => false,
    });
    const result = await requestOnboardingPermissions(deps);
    assert.deepEqual(result.notifications, { state: 'denied', subscribed: false, promotional: true });
  });

  test('a first native push request failure is retried before giving up', async () => {
    let attempts = 0;
    const { deps } = makeDeps({
      isNativePush: () => true,
      requestNativePushPermission: async () => {
        attempts += 1;
        return attempts === 2;
      },
    });
    const result = await requestOnboardingPermissions(deps);
    assert.equal(result.notifications.state, 'granted');
    assert.equal(result.notifications.subscribed, true);
    assert.equal(attempts, 2);
  });

  test('notification denial after the prompt is reported as denied', async () => {
    const { deps } = makeDeps({ requestNotificationPermission: async () => 'denied' });
    const result = await requestOnboardingPermissions(deps);
    assert.deepEqual(result.notifications, { state: 'denied', subscribed: false, promotional: true });
  });

  test('granted notification permission without a subscription stays unsubscribed', async () => {
    const { deps } = makeDeps({ subscribeToPush: async () => false });
    const result = await requestOnboardingPermissions(deps);
    assert.deepEqual(result.notifications, { state: 'granted', subscribed: false, promotional: true });
  });

  test('a first push subscribe failure is retried before giving up', async () => {
    let attempts = 0;
    const { deps } = makeDeps({
      subscribeToPush: async () => {
        attempts += 1;
        return attempts === 2;
      },
    });
    const result = await requestOnboardingPermissions(deps);
    assert.equal(result.notifications.state, 'granted');
    assert.equal(result.notifications.subscribed, true);
    assert.equal(attempts, 2);
  });

  test('all location results are reported without blocking notifications', async () => {
    const cases = [
      ['kept', 'granted'],
      ['denied', 'denied'],
      ['unavailable', 'unavailable'],
      ['busy', 'error'],
    ] as const;
    for (const [status, state] of cases) {
      const { deps } = makeDeps({ detectDeliveryLocation: async () => ({ status }) });
      const result = await requestOnboardingPermissions(deps);
      assert.equal(result.location.state, state);
      assert.equal(result.notifications.state, 'granted');
    }
  });

  test('the fire-and-forget starter cannot hold the page open', () => {
    const source = readFileSync(new URL('../src/services/onboardingPermissions.ts', import.meta.url), 'utf8');
    assert.match(source, /export function startOnboardingPermissions\(deps: OnboardingPermissionDeps\): void \{/);
    assert.match(source, /void requestOnboardingPermissions\(deps\)\.catch/);
    assert.match(source, /enablePromotionalNotifications\(\)/);
    assert.match(source, /PERMISSION_QUERY_TIMEOUT_MS/);
    assert.match(source, /LOCATION_DETECTION_TIMEOUT_MS/);
    assert.match(source, /PUSH_WORK_TIMEOUT_MS/);
    assert.match(source, /PUSH_RETRY_DELAY_MS/);
  });
});
