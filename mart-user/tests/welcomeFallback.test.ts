import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import WelcomeVisual from '../src/components/WelcomeVisual';

const render = (status: 'loading' | 'loaded' | 'failed') => renderToStaticMarkup(createElement(WelcomeVisual, {
  status,
  imageRef: { current: null },
  onImageLoad: () => {},
  onImageError: () => {},
}));

describe('welcome visual', () => {
  test('the artwork renders while loading and after it loads', () => {
    for (const status of ['loading', 'loaded'] as const) {
      const html = render(status);
      assert.match(html, /<img[^>]+src="\/get_started\.webp"/);
      assert.doesNotMatch(html, /Welcome to Gokez Mart/);
    }
  });

  test('a failed image is replaced by the code-based fallback', () => {
    const html = render('failed');
    assert.doesNotMatch(html, /<img/);
    assert.match(html, /Welcome to Gokez Mart/);
    assert.match(html, /Bringing Your Neighbourhood Shops Online\./);
    assert.match(html, /We’re on a mission to help local shops grow and thrive/);
    assert.match(html, /bg-white/);
    assert.match(html, /text-\[#087A43\]/);
    assert.match(html, /bg-\[#F4C400\]/);
  });
});
