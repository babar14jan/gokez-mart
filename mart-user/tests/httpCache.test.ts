import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCacheKey, getEntry, setEntry, getInflight, startInflight,
  clearHttpCache, getCacheGeneration, CACHE_FRESH_MS, CACHE_MAX_AGE_MS,
} from '../src/services/httpCache';

const response = { data: { ok: true }, status: 200, statusText: 'OK', headers: {} };

test('cache key is stable across param order and drops undefined', () => {
  const a = buildCacheKey({ url: '/products', method: 'get', params: { storeId: 's1', categoryId: undefined } });
  const b = buildCacheKey({ url: '/products', method: 'get', params: { categoryId: undefined, storeId: 's1' } });
  assert.equal(a, b);
  const c = buildCacheKey({ url: '/products', method: 'get', params: {} });
  assert.notEqual(a, c);
});

test('cache key distinguishes url and nested param shape', () => {
  const a = buildCacheKey({ url: '/orders/track/tokens', method: 'get', params: { tokens: 'a,b' } });
  const b = buildCacheKey({ url: '/orders/track/tokens', method: 'get', params: { tokens: 'a,b,c' } });
  const c = buildCacheKey({ url: '/orders/track/tokens', method: 'post', params: { tokens: 'a,b' } });
  assert.notEqual(a, b);
  assert.notEqual(a, c);
});

test('entries round-trip and staleness windows are ordered', () => {
  clearHttpCache();
  const key = buildCacheKey({ url: '/categories', method: 'get' });
  assert.equal(getEntry(key), undefined);
  setEntry(key, response);
  assert.deepEqual(getEntry(key)?.response.data, { ok: true });
  assert.ok(CACHE_FRESH_MS < CACHE_MAX_AGE_MS);
});

test('in-flight record settles and clears itself', async () => {
  clearHttpCache();
  const key = 'get /x undefined';
  const record = startInflight(key);
  assert.equal(getInflight(key), record);
  record.resolve('done');
  assert.equal(await record.promise, 'done');
  await record.promise;
  assert.equal(getInflight(key), undefined);
});

test('rejected in-flight record clears itself', async () => {
  clearHttpCache();
  const record = startInflight('get /y undefined');
  record.reject(new Error('boom'));
  await assert.rejects(record.promise, /boom/);
  assert.equal(getInflight('get /y undefined'), undefined);
});

test('clearHttpCache wipes entries and in-flight map', async () => {
  clearHttpCache();
  setEntry('k1', response);
  startInflight('k2');
  clearHttpCache();
  assert.equal(getEntry('k1'), undefined);
  assert.equal(getInflight('k2'), undefined);
});

test('clearHttpCache settles in-flight joiners instead of hanging them', async () => {
  clearHttpCache();
  const record = startInflight('k3');
  clearHttpCache();
  // The joiner awaiting this record's promise must not hang; it is rejected so
  // it can retry against the emptied cache.
  await assert.rejects(record.promise, /cache cleared/);
});

test('clearHttpCache bumps the generation so pre-mutation reads cannot re-cache', () => {
  clearHttpCache();
  const before = getCacheGeneration();
  clearHttpCache();
  assert.equal(getCacheGeneration(), before + 1);
});
