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

  test('shows the bold freshness headline with the yellow accent below it', () => {
    const html = render();
    assert.match(html, /Daily Freshness From Neighbourhoods Local Shops/);
    assert.match(html, /Daily Freshness From Neighbourhoods Local Shops<\/h1>[\s\S]*?bg-\[#F4C400\]/);
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

  test('both actions are real buttons with the shared near-white skip style for Maybe Later', () => {
    const html = render();
    assert.match(html, /<button[^>]*type="button"[^>]*min-h-\[52px\][^>]*>.*Allow &amp; Continue/s);
    assert.match(html, /<button[^>]*type="button"[^>]*permissions-later-button onboarding-skip-button[^>]*min-h-9[^>]*bg-white\/95[^>]*>.*Maybe Later/s);
    assert.match(html, /hover:bg-white active:bg-\[#F4FBF5\]/);
    assert.doesNotMatch(html, /bg-\[#9AEFAF\]/);
    assert.doesNotMatch(html, /min-h-\[48px\]/);
  });

  test('aligns both skip buttons with the centred page content', () => {
    const css = readSource('src/index.css');
    assert.match(css, /\.onboarding-skip-button \{[\s\S]*?right: calc\(\(100% - min\(100%, 24rem\)\) \/ 2 \+ var\(--onboarding-skip-gutter\) \+ env\(safe-area-inset-right, 0px\)\);/);
    assert.match(css, /@media \(min-width: 640px\) \{\s*\.onboarding-skip-button \{\s*--onboarding-skip-gutter: 1\.5rem;/);
    const account = readSource('src/pages/AccountPage.tsx');
    const loginSkip = account.slice(account.indexOf('onClick={leaveAsGuest}'), account.indexOf('Skip<ChevronRight'));
    assert.match(loginSkip, /onboarding-skip-button/);
    assert.doesNotMatch(loginSkip, /right-\[calc\(/);
  });

  test('keeps the primary action at the same bottom gap as the welcome button', () => {
    const css = readSource('src/index.css');
    assert.match(css, /\.onboarding-action-bar \{[\s\S]*?bottom: calc\(env\(safe-area-inset-bottom, 0px\) \+ clamp\(2rem, 3\.5vh, 2\.5rem\)\);/);
    assert.match(css, /@media \(max-height: 520px\) \{\s*\.onboarding-action-bar \{\s*bottom: calc\(env\(safe-area-inset-bottom, 0px\) \+ 1rem \+ 12px\);/);
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

  test('finishing permissions consumes the deferred guest login prompt', () => {
    const app = readSource('src/App.tsx');
    assert.match(app, /sessionStorage\.setItem\(BOOT_LOGIN_DONE_KEY, '1'\)/);
    assert.match(app, /if \(sessionStorage\.getItem\(BOOT_LOGIN_DONE_KEY\)\) return;/);
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

  test('the legacy popup is cancelled on onboarding routes and once the permissions page is seen', () => {
    const prompt = readSource('src/components/PushOptInPrompt.tsx');
    assert.match(prompt, /if \(isAlwaysLightRoute\(\)\) return;/);
    assert.match(prompt, /window\.setTimeout\(\(\) => \{[\s\S]*?if \(isAlwaysLightRoute\(\)\) return;[\s\S]*?if \(hasSeenPermissionsPage\(\)\) return;[\s\S]*?if \(!canShowPushPrompt\(\)\) return;[\s\S]*?if \(!isPushOptInDue\('legacy'\)\) return;/);
    assert.match(prompt, /\}, \[isLoggedIn, routeTick\]\);/);
  });

  test('route changes re-arm the legacy popup instead of leaving the light login route stuck', () => {
    const prompt = readSource('src/components/PushOptInPrompt.tsx');
    assert.match(prompt, /const \[routeTick, setRouteTick\] = useState\(0\)/);
    assert.match(prompt, /const onPop = \(\) => setRouteTick\(tick => tick \+ 1\)/);
    assert.match(prompt, /window\.addEventListener\('popstate', onPop\)/);
    assert.match(prompt, /return \(\) => window\.removeEventListener\('popstate', onPop\)/);
  });

  test('login success normalises history and replays the route for every listener', () => {
    const app = readSource('src/App.tsx');
    assert.match(app, /if \(pendingCheckout \|\| redirect === '\/checkout'\) \{/);
    assert.match(app, /path = '\/checkout';[\s\S]*?path = '\/orders';[\s\S]*?window\.history\.replaceState\(\{\}, '', path\);/);
    assert.match(app, /window\.dispatchEvent\(new PopStateEvent\('popstate'\)\);/);
  });

  test('Maybe Later does not ask the popup immediately', () => {
    const app = readSource('src/App.tsx');
    assert.match(app, /onMaybeLater=\{finishPermissionsOnboarding\}/);
    assert.doesNotMatch(app, /declinePromptTimerRef/);
    assert.doesNotMatch(app, /requestPushOptInPrompt\('permissions-decline'\)/);
    assert.match(app, /startOnboardingPermissions\(\{/);
    assert.doesNotMatch(app, /await requestOnboardingPermissions/);
    assert.doesNotMatch(app, /onAllow=\{finishPermissionsOnboarding\}/);
  });

  test('the popup waits for the first successful order while notifications are undecided', () => {
    const app = readSource('src/App.tsx');
    assert.match(app, /firstOrder = !localStorage\.getItem\(FIRST_ORDER_KEY\)/);
    assert.match(app, /if \(!firstOrder\) return;/);
    assert.match(app, /getNotificationPermission\(\) !== 'default'/);
    assert.match(app, /recordPermissionPrompt\(ORDER_NOTIFICATION_PROMPT_KEY\)/);
    assert.match(app, /requestPushOptInPrompt\('later-order'\)/);
    assert.doesNotMatch(app, /checkoutOpenedRef/);
  });

  test('later-order and permissions-decline prompts keep separate cooldowns', () => {
    const push = readSource('src/services/push.ts');
    assert.match(push, /LATER_ORDER_PUSH_PROMPT_KEY = 'mart_later_order_push_prompt_at'/);
    assert.match(push, /PERMISSIONS_DECLINE_PUSH_PROMPT_KEY = 'mart_permissions_decline_push_prompt_at'/);
    assert.match(push, /if \(reason === 'permissions-decline'\) return PERMISSIONS_DECLINE_PUSH_PROMPT_KEY/);
  });

  test('a guest can subscribe before the first order and syncs consent after it', () => {
    const push = readSource('src/services/push.ts');
    assert.doesNotMatch(push, /if \(!authed && tokens\.length === 0\) return false;/);
    assert.match(push, /if \(tokens\.length === 0\) return true;/);
    assert.match(push, /GUEST_SUBSCRIBED_TOKEN_KEY = 'mart_guest_subscribed_token'/);
    assert.match(push, /localStorage\.removeItem\(GUEST_SUBSCRIBED_TOKEN_KEY\)/);
    assert.match(push, /forgetSubscribedGuestToken\(\);\s*if \(tokens\.length === 0\) return true;/);
    assert.match(push, /rememberSubscribedGuestToken\(trackingToken\)/);
    assert.match(push, /const consentToken = getSubscribedGuestToken\(\);/);
    assert.match(push, /if \(consentToken && marketingConsent\) \{[\s\S]*?updateGuestMarketingConsent\(consentToken, true\)/);
    assert.match(push, /if \(trackingToken\) await authApi\.updateGuestMarketingConsent\(trackingToken, true\)/);
    assert.doesNotMatch(push, /updateGuestMarketingConsent\(tokens\[tokens\.length - 1\]/);
    const account = readSource('src/pages/AccountPage.tsx');
    assert.match(account, /getSubscribedGuestToken\(\)/);
    assert.doesNotMatch(account, /readTrackingTokens/);
  });
});
