import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import WelcomeVisual from '../src/components/WelcomeVisual';
import { isEffectiveAlwaysLightRoute } from '../src/constants/brand';

const render = () => renderToStaticMarkup(createElement(WelcomeVisual));

const readSrc = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8');

const assertWebp = (name: string) => {
  const bytes = readFileSync(new URL(`../public/${name}`, import.meta.url));
  assert.ok(bytes.length > 12, `${name} has no WebP header`);
  assert.equal(bytes.toString('ascii', 0, 4), 'RIFF', `${name} is missing the RIFF header`);
  assert.equal(bytes.toString('ascii', 8, 12), 'WEBP', `${name} is missing the WEBP header`);
};

describe('welcome visual', () => {
  test('the normal page always shows both supplied images and the fallback copy', () => {
    const html = render();
    assert.match(html, /login-brand-bg/);
    assert.match(html, /<img[^>]+src="\/logo_and_brand_white_g\.webp"/);
    assert.ok(existsSync(new URL('../public/logo_and_brand_white_g.webp', import.meta.url)));
    assertWebp('logo_and_brand_white_g.webp');
    assert.match(html, /login-brand-unit block h-auto max-w-full select-none object-contain/);
    assert.doesNotMatch(html, /welcome-brand-unit/);
    assert.match(html, /<img[^>]+src="\/welcome_image\.webp"/);
    assert.ok(existsSync(new URL('../public/welcome_image.webp', import.meta.url)));
    assertWebp('welcome_image.webp');
    assert.doesNotMatch(html, /get_started\.webp/);
    assert.match(html, /Welcome to Gokez Mart/);
    assert.match(html, /Bringing Your Neighbourhood Shops Online\./);
    assert.match(html, /We’re on a mission to help local shops grow and thrive/);
    assert.match(html, /welcome-fallback-quote[^>]*text-\[16px\][^>]*font-bold[^>]*text-\[#5A4100\]/);
    assert.match(html, /text-\[#087A43\]/);
    assert.match(html, /bg-\[#F4C400\]/);
  });

  test('missing brand art falls back to text instead of a broken image', () => {
    const visual = readSrc('../src/components/WelcomeVisual.tsx');
    assert.match(visual, /onError=\{\(\) => setLogoFailed\(true\)\}/);
    assert.match(visual, /onError=\{\(\) => setArtFailed\(true\)\}/);
    assert.match(visual, /login-brand-fallback[\s\S]*?Gokez Mart/);
    const account = readSrc('../src/pages/AccountPage.tsx');
    assert.match(account, /onError=\{\(\) => setBrandImgError\(true\)\}/);
    assert.match(account, /login-brand-fallback[\s\S]*?Gokez Mart/);
  });

  test('the welcome content scrolls instead of freezing touch movement', () => {
    const css = readSrc('../src/index.css');
    assert.match(css, /\.welcome-screen \.login-brand-bg \{[\s\S]*?background-image: none/);
    assert.match(css, /\.welcome-screen \.onboarding-scroll \{[\s\S]*?padding-top: clamp\(12px[\s\S]*?-webkit-overflow-scrolling: touch/);
    assert.ok(css.includes('bottom: calc(env(safe-area-inset-bottom, 0px) + clamp(0.75rem, 2.2vh, 1.25rem) + 10px)'));
    assert.ok(css.includes('bottom: calc(env(safe-area-inset-bottom, 0px) + 0.5rem + 10px)'));
    assert.ok(css.includes('padding-left: calc(1rem + env(safe-area-inset-left, 0px))'));
    assert.doesNotMatch(css, /\.welcome-brand-unit/);
    assert.match(css, /\.welcome-image \{[\s\S]*?width: min\(62vw, 220px\)/);
    assert.doesNotMatch(css, /@media \(max-width: 639px\) and \(max-height: 520px\) \{[\s\S]*?\.welcome-image/);
    assert.doesNotMatch(css, /\.welcome-art/);
    const welcomeShell = css.slice(
      css.indexOf('.app-shell.welcome-active .app-scroll'),
      css.indexOf('.welcome-screen {', css.indexOf('.app-shell.welcome-active .app-scroll')),
    );
    assert.doesNotMatch(welcomeShell, /touch-action: none/);
  });

  test('the login page uses one combined brand image instead of three parts', () => {
    const account = readSrc('../src/pages/AccountPage.tsx');
    assert.match(account, /src="\/logo_and_brand_white_g\.webp"/);
    assert.doesNotMatch(account, /gokez_mart_logo-header\.png/);
    assert.doesNotMatch(account, /mart_brand_new\.webp/);
    assert.doesNotMatch(account, /login-brand-tagline/);
    assert.match(account, /Your local shops,<br \/>\s*now delivered in minutes\./);
    assert.match(account, /text-\[#5A4100\] dark:text-\[#F4C400\]/);
    assert.match(account, /login-brand-header relative flex items-start justify-start/);
    const brandHeader = account.slice(account.indexOf('login-brand-header relative'), account.indexOf('login-form-area'));
    assert.doesNotMatch(brandHeader, /-translate-y-/);
    const css = readSrc('../src/index.css');
    assert.match(css, /\.login-brand-unit \{[\s\S]*?top: 10px;[\s\S]*?width: clamp\(64px, 26vw, 88px\)/);
    const punchline = css.slice(css.indexOf('.login-punchline {'), css.indexOf('@media (max-height: 700px)'));
    assert.match(punchline, /max-width: min\(260px, calc\(100vw - 2rem/);
    assert.match(punchline, /white-space: normal/);
    assert.match(punchline, /overflow-wrap: anywhere/);
    assert.doesNotMatch(punchline, /white-space: nowrap/);
    assert.match(css, /@media \(max-width: 360px\) and \(min-height: 521px\)/);
  });

  test('app chrome keeps a neutral nav and onboarding routes stay light', () => {
    const app = readSrc('../src/App.tsx');
    const nav = readSrc('../src/components/BottomNav.tsx');
    const css = readSrc('../src/index.css');
    const themeStore = readSrc('../src/store/themeStore.ts');
    const nativeApp = readSrc('../src/services/nativeApp.ts');
    assert.match(app, /const effectiveDark = isDark && !loginActive && !permissionsActive && !welcomeActive;/);
    assert.match(app, /const themeColor = effectiveDark \? APP_CHROME_DARK : APP_CHROME_LIGHT;/);
    assert.match(nav, /bg-\[#f7f8fa\]/);
    assert.match(nav, /dark:bg-slate-900/);
    assert.match(css, /\.app-tint-bottom \{[\s\S]*?background-color: #f7f8fa;/);
    assert.match(css, /\.dark \.app-tint-bottom \{[\s\S]*?background-color: #18191a;/);
    assert.match(app, /if \(!window\.location\.search\) \{\s*window\.history\.replaceState\(\{\}, '', '\/login'\);/);
    assert.match(themeStore, /if \(isEffectiveAlwaysLightRoute\(\)\)/);
    assert.match(nativeApp, /!isEffectiveAlwaysLightRoute\(\) && document\.documentElement\.classList\.contains\('dark'\)/);
    const html = readSrc('../index.html');
    assert.match(html, /localStorage\.getItem\('mart-theme'\)/);
    assert.match(html, /classList\.add\('dark'\)[\s\S]*?classList\.remove\('dark'\)/);
    assert.match(html, /setAttribute\('content', isDark \? '#18191a' : '#ADFBBD'\)/);
    assert.match(html, /!window\.location\.search/);
    const rootBranch = app.slice(app.indexOf("if (path === '/') {"), app.indexOf('// Unrecognized/private routes'));
    const signedOutRoot = rootBranch.slice(rootBranch.indexOf('if (!welcomeSeen) {'));
    const loginNormalizeAt = signedOutRoot.indexOf('if (!window.location.search)');
    const lastViewAt = signedOutRoot.indexOf('LAST_VIEW_KEY');
    assert.ok(loginNormalizeAt >= 0 && lastViewAt > loginNormalizeAt);
  });

  test('the effective light route uses the resolved route, not the raw path', () => {
    const previous = (globalThis as any).localStorage;
    const store = new Map<string, string>();
    (globalThis as any).localStorage = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => { store.set(key, value); },
      removeItem: (key: string) => { store.delete(key); },
    };
    try {
      assert.equal(isEffectiveAlwaysLightRoute('/login', ''), true);
      assert.equal(isEffectiveAlwaysLightRoute('/welcome', ''), true);
      assert.equal(isEffectiveAlwaysLightRoute('/permissions', ''), true);
      assert.equal(isEffectiveAlwaysLightRoute('/', ''), true);
      store.set('gokez_mart_welcome_seen_v1', 'true');
      assert.equal(isEffectiveAlwaysLightRoute('/', ''), true);
      assert.equal(isEffectiveAlwaysLightRoute('/', '?utm_source=qr'), false);
      store.set('mart-customer-auth', JSON.stringify({ state: { isLoggedIn: true }, version: 0 }));
      assert.equal(isEffectiveAlwaysLightRoute('/', ''), false);
      assert.equal(isEffectiveAlwaysLightRoute('/login', ''), true);
    } finally {
      (globalThis as any).localStorage = previous;
    }
  });

  test('otp verification heading keeps clear space above the code boxes', () => {
    const loginFlow = readSrc('../src/components/LoginFlow.tsx');
    assert.match(loginFlow, /OTP Verification[\s\S]*?className="mt-6 space-y-2"/);
  });
});
