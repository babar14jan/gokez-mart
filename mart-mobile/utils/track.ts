import { Platform } from 'react-native';
import { funnelApi, type FunnelEventBody } from '@/services/api';
import { useFunnelStore } from '@/store/funnelStore';

export type FunnelEvent =
  | 'session_start'
  | 'login_viewed'
  | 'login_field_focused'
  | 'login_number_entered'
  | 'otp_requested'
  | 'otp_entered'
  | 'otp_verification_failed'
  | 'otp_viewed'
  | 'login_verified'
  | 'login_abandoned'
  | 'product_viewed'
  | 'product_search'
  | 'search_zero_results'
  | 'category_viewed'
  | 'cart_started'
  | 'cart_added'
  | 'cart_updated'
  | 'cart_removed'
  | 'cart_cleared'
  | 'checkout_started'
  | 'checkout_address_started'
  | 'checkout_address_completed'
  | 'checkout_reviewed'
  | 'order_placed'
  | 'order_cancelled'
  | 'order_completed'
  | 'suggest_product_submitted'
  | 'share_app_clicked';

export type InstallEventName =
  | 'install_prompt_shown'
  | 'install_prompt_accepted'
  | 'install_prompt_declined'
  | 'install_guide_opened'
  | 'install_guide_dismissed'
  | 'app_installed';

export type NativePlatform = 'android' | 'ios';

const platform: NativePlatform = Platform.OS === 'ios' ? 'ios' : 'android';

export function track(eventName: FunnelEvent | string, props?: Record<string, unknown>): void {
  try {
    const store = useFunnelStore.getState();
    const body: FunnelEventBody = {
      sessionId: store.getSessionId(),
      visitorId: store.getVisitorId(),
      eventName,
      channel: store.channel,
      platform,
      deviceCategory: 'mobile',
      props: props ?? {},
    };
    void funnelApi.event(body).catch(() => undefined);
  } catch {}
}

export function syncFunnelCart(items: unknown[], options: { reachedCheckout?: boolean } = {}): void {
  try {
    const sessionId = useFunnelStore.getState().getSessionId();
    void funnelApi.cart({ sessionId, items, reachedCheckout: options.reachedCheckout === true })
      .catch(() => undefined);
  } catch {}
}

export function trackCampaignTouch(campaignId: string | number | null | undefined): void {
  if (!campaignId) return;
  try {
    const sessionId = useFunnelStore.getState().getSessionId();
    void funnelApi.campaign({ sessionId, campaignId: String(campaignId) }).catch(() => undefined);
  } catch {}
}

export function trackInstall(eventName: InstallEventName, installPlatform: NativePlatform = platform): void {
  try {
    const store = useFunnelStore.getState();
    void funnelApi.install({
      sessionId: store.getSessionId(),
      visitorId: store.getVisitorId(),
      platform: installPlatform,
      eventName,
    }).catch(() => undefined);
  } catch {}
}

const emitted = new Set<string>();

export function trackOnce(eventName: FunnelEvent | string, props?: Record<string, unknown>): void {
  if (emitted.has(eventName)) return;
  emitted.add(eventName);
  track(eventName, props);
}
