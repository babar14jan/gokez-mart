import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import PermissionsOnboarding from '../src/components/PermissionsOnboarding';

const readSource = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

const render = () => renderToStaticMarkup(createElement(PermissionsOnboarding, {
  onAllow: async () => {},
  onMaybeLater: () => {},
}));

describe('permissions onboarding screen', () => {
  test('uses the same colour pattern without brand art', () => {
    const html = render();
    assert.ok(html.includes('bg-[#ADFBBD]'));
    assert.ok(html.includes('bg-[#F0FAF1]'));
    assert.ok(html.includes('bg-[#087A43]'));
    assert.ok(html.includes('bg-[#F4C400]'));
    assert.ok(!html.includes('gokez_mart_logo'));
    assert.ok(!html.includes('Shop Local'));
    assert.ok(!html.includes('Illustration of'));
  });

  test('shows the bold freshness headline', () => {
    const html = render();
    assert.match(html, /Daily Freshness From Neighbourhoods Local Shops/);
    assert.doesNotMatch(html, /Let&#x27;s get you started!/);
  });

  test('shows both permission cards with lucide icons and subtitles', () => {
    const html = render();
    assert.match(html, /M20 10c0 6-8 12-8 12s-8-6-8-12/);
    assert.match(html, /Fresh picks, and local deals-right from shops near you/);
    assert.match(html, /Enable location access/);
    assert.match(html, /M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9/);
    assert.match(html, /Order updates, price drops, flash sales, deals and new arrivals/);
    assert.match(html, /Turn on notifications and offers/);
    assert.doesNotMatch(html, /Turn on promotional notifications/);
  });

  test('notes that permissions can be turned off in account settings', () => {
    const html = render();
    assert.match(html, /You can turn off any permission anytime from Account → Settings\./);
  });

  test('both actions are real buttons with accessible touch targets', () => {
    const html = render();
    assert.match(html, /<button[^>]*type="button"[^>]*min-h-\[52px\][^>]*>.*Allow &amp; Continue/s);
    assert.match(html, /<button[^>]*type="button"[^>]*min-h-\[48px\][^>]*>Maybe Later<\/button>/);
  });

  test('Allow starts the work without waiting for a permission result', () => {
    const component = readSource('src/components/PermissionsOnboarding.tsx');
    assert.match(component, /const handleAllow = \(\) => \{/);
    assert.match(component, /void Promise\.resolve\(onAllow\(\)\)\.catch/);
    assert.doesNotMatch(component, /await onAllow\(\)/);
    assert.doesNotMatch(component, /Setting up your experience/);
    assert.doesNotMatch(component, /Loader2/);
  });

  test('one tap covers native push, browser notification, and promotional consent', () => {
    const app = readSource('src/App.tsx');
    assert.match(app, /enablePromotionalNotifications,/);
    assert.match(app, /isNotificationSupported,/);

    const push = readSource('src/services/push.ts');
    assert.match(push, /export function isNotificationSupported\(\): boolean \{/);
    assert.match(push, /requestPermission\(\(value: NotificationPermission\) => finish\(value\)\)/);
    assert.match(push, /export async function enablePromotionalNotifications\(\): Promise<boolean> \{/);
  });
});

describe('opt-in prompt after permissions onboarding', () => {
  test('the old timed popup waits for an explicit request once onboarding has run', () => {
    const prompt = readSource('src/components/PushOptInPrompt.tsx');
    assert.match(prompt, /hasSeenPermissionsPage\(\)/);
    assert.match(prompt, /PUSH_OPT_IN_REQUEST_EVENT/);
    assert.match(prompt, /Notification\.permission !== 'default'/);
    assert.match(prompt, /Stay updated/);
    assert.match(prompt, /Not now/);
    assert.match(prompt, /Enable/);
  });

  test('only Maybe Later asks the popup immediately', () => {
    const app = readSource('src/App.tsx');
    assert.match(app, /onMaybeLater=\{\(\) => finishPermissionsOnboarding\(true\)\}/);
    assert.match(app, /declinePromptTimerRef\.current = window\.setTimeout\(\(\) => \{[\s\S]*requestPushOptInPrompt\('permissions-decline'\)/);
    assert.match(app, /startOnboardingPermissions\(\{/);
    assert.doesNotMatch(app, /await requestOnboardingPermissions/);
    assert.doesNotMatch(app, /onAllow=\{finishPermissionsOnboarding\}/);
  });

  test('a later order-open asks again only after a first order and while notifications are undecided', () => {
    const app = readSource('src/App.tsx');
    assert.match(app, /FIRST_ORDER_KEY/);
    assert.match(app, /localStorage\.getItem\(FIRST_ORDER_KEY\)/);
    assert.match(app, /getNotificationPermission\(\) !== 'default'/);
    assert.match(app, /requestPushOptInPrompt\('later-order'\)/);
  });

  test('later-order and permissions-decline prompts keep separate cooldowns', () => {
    const push = readSource('src/services/push.ts');
    assert.match(push, /LATER_ORDER_PUSH_PROMPT_KEY = 'mart_later_order_push_prompt_at'/);
    assert.match(push, /PERMISSIONS_DECLINE_PUSH_PROMPT_KEY = 'mart_permissions_decline_push_prompt_at'/);
    assert.match(push, /if \(reason === 'permissions-decline'\) return PERMISSIONS_DECLINE_PUSH_PROMPT_KEY/);
  });
});
