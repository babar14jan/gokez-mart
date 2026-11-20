import test from 'node:test';
import assert from 'node:assert/strict';

test('referral login clears stale intent and returns to the entry page', async () => {
  const historyCalls: string[] = [];
  const values = new Map<string, string>();

  class PopStateEventStub {
    type: string;
    constructor(type: string) { this.type = type; }
  }

  (globalThis as any).PopStateEvent = PopStateEventStub;
  (globalThis as any).window = {
    history: {
      replaceState: (_state: unknown, _title: unknown, path: string) => historyCalls.push(path),
    },
    dispatchEvent: (event: { type: string }) => historyCalls.push(event.type),
  };
  (globalThis as any).sessionStorage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  };

  const { openReferralLogin } = await import('../src/utils/referralLogin');
  const { useLoginFlowStore } = await import('../src/store/loginFlowStore');
  const { useAccountLoginStore } = await import('../src/store/accountLoginStore');

  useLoginFlowStore.setState({
    phone: '9999999999',
    expiresAt: Date.now() + 60000,
    resendAvailableAt: Date.now() + 30000,
    pendingCouponApply: true,
    pendingCampaignId: 'stale-campaign',
  });

  openReferralLogin('/account');

  const flow = useLoginFlowStore.getState();
  assert.equal(flow.postLoginPath, '/account');
  assert.equal(flow.guestReturnPath, '/account');
  assert.equal(flow.pendingCouponApply, false);
  assert.equal(flow.pendingCampaignId, null);
  assert.equal(flow.phone, null);
  assert.equal(useAccountLoginStore.getState().open, true);
  assert.deepEqual(historyCalls, ['/login', 'popstate']);
});
