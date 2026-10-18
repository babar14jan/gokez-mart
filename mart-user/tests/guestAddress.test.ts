/**
 * Guest address persistence contract.
 *
 * A guest's single delivery address lives in localStorage (the server address
 * book is behind login). These tests pin the two regressions the util exists
 * to prevent:
 *   1. a reload used to drop the label and coordinates, degrading the address
 *      to a bare string (which silently fails the delivery-zone check),
 *   2. saving without coordinates used to leave the previous coordinates
 *      attached to the new address text — a stale pin on a new address.
 *
 * The util guards on `typeof window`, so a window+localStorage pair is
 * installed on globalThis before it is imported. Node's built-in runner via
 * tsx, same as the backend suites.
 */

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

class MemoryStorage {
  private store = new Map<string, string>();
  getItem(key: string): string | null { return this.store.has(key) ? this.store.get(key)! : null; }
  setItem(key: string, value: string): void { this.store.set(key, String(value)); }
  removeItem(key: string): void { this.store.delete(key); }
  clear(): void { this.store.clear(); }
}

(globalThis as any).localStorage = new MemoryStorage();
(globalThis as any).window = globalThis;

const { readGuestAddress, writeGuestAddress, clearGuestAddress } = await import('../src/utils/guestAddress');
const { useGuestAddressStore } = await import('../src/store/guestAddressStore');

beforeEach(() => {
  (globalThis as any).localStorage.clear();
});

describe('Guest address persistence', () => {
  test('round-trips the full address: text, label and coordinates', () => {
    writeGuestAddress('Home', '12, Rose Villa, Kothrud, Pune 411038', { latitude: 17.385, longitude: 78.4867 });
    const read = readGuestAddress();
    assert.ok(read);
    assert.equal(read!.address, '12, Rose Villa, Kothrud, Pune 411038');
    assert.equal(read!.label, 'Home');
    assert.equal(read!.latitude, 17.385);
    assert.equal(read!.longitude, 78.4867);
    assert.equal(read!.isDefault, true, 'the guest address is always their current address');
  });

  test('a label survives the round trip (a reload used to degrade it to Home)', () => {
    writeGuestAddress('Work', '7, FC Road, Pune 411004', null);
    assert.equal(readGuestAddress()?.label, 'Work');
  });

  test('re-saving without coordinates clears the previous ones — no stale pin', () => {
    writeGuestAddress('Home', '12, Rose Villa, Kothrud, Pune 411038', { latitude: 17.385, longitude: 78.4867 });
    // The shopper edits to a text-only address: the old pin must not ride along.
    writeGuestAddress('Home', '9, Lane 3, Baner, Pune 411045', null);
    const read = readGuestAddress();
    assert.equal(read?.address, '9, Lane 3, Baner, Pune 411045');
    assert.equal(read?.latitude, null, 'stale coordinates are dropped with the address they belonged to');
    assert.equal(read?.longitude, null);
  });

  test('replacing the address keeps the sheet a single-slot book', () => {
    writeGuestAddress('Home', '12, Rose Villa, Kothrud, Pune 411038', null);
    writeGuestAddress('Work', '7, FC Road, Pune 411004', null);
    const read = readGuestAddress();
    assert.equal(read?.address, '7, FC Road, Pune 411004', 'edit/replace overwrites, never appends');
  });

  test('an empty address clears the whole entry', () => {
    writeGuestAddress('Home', '12, Rose Villa, Kothrud, Pune 411038', { latitude: 17.385, longitude: 78.4867 });
    writeGuestAddress('Home', '', null);
    assert.equal(readGuestAddress(), null);
  });

  test('clearGuestAddress removes every key', () => {
    writeGuestAddress('Home', '12, Rose Villa, Kothrud, Pune 411038', { latitude: 17.385, longitude: 78.4867 });
    clearGuestAddress();
    assert.equal(readGuestAddress(), null);
    assert.equal(localStorage.getItem('guest_address'), null);
  });

  test('read returns null when nothing is stored', () => {
    assert.equal(readGuestAddress(), null);
  });
});

describe('Guest address store keeps one reactive copy of the persisted address', () => {
  test('setAddress updates the shared state and persists it', () => {
    useGuestAddressStore.getState().setAddress('Home', '12, Rose Villa, Kothrud, Pune 411038', { latitude: 17.385, longitude: 78.4867 });
    const { address } = useGuestAddressStore.getState();
    assert.equal(address?.address, '12, Rose Villa, Kothrud, Pune 411038');
    assert.equal(address?.latitude, 17.385);
    assert.equal(readGuestAddress()?.address, '12, Rose Villa, Kothrud, Pune 411038');
  });

  test('a save made on one page is visible to the next reader (no stale shadow copy)', () => {
    useGuestAddressStore.getState().setAddress('Work', '7, FC Road, Pune 411004', null);
    // The checkout footer and the account page both read this same value, so an
    // edit updates everywhere at once instead of only on the next launch.
    assert.equal(useGuestAddressStore.getState().address?.address, '7, FC Road, Pune 411004');
    assert.equal(useGuestAddressStore.getState().address?.label, 'Work');
  });

  test('clearAddress drops both the state and the stored keys', () => {
    useGuestAddressStore.getState().setAddress('Home', '12, Rose Villa, Kothrud, Pune 411038', null);
    useGuestAddressStore.getState().clearAddress();
    assert.equal(useGuestAddressStore.getState().address, null);
    assert.equal(readGuestAddress(), null);
  });
});
