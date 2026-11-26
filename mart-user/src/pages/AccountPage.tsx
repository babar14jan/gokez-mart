import { useState, useEffect, useLayoutEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Phone, MessageCircle, Bell, Navigation, ShieldCheck, FileText, ChevronRight, Headphones, MessageSquare, Share, Moon, Sun, X, Sparkles, Info, Gift, Home } from 'lucide-react';
import { authApi, referralApi, suggestionApi, type ReferralMeData } from '../services/api';
import { useCustomerAuthStore } from '../store/customerAuthStore';
import { useThemeStore } from '../store/themeStore';
import { useZoneStore } from '../store/zoneStore';
import { getLocationPermission, getNotificationPermission, requestNotificationPermission, subscribeToPush, unsubscribeFromPush, hasActivePushSubscription, isPushSupported } from '../services/push';
import { clearNativePushAssociation, hasNativePushToken, isNativePush, requestNativePushPermission } from '../services/nativePush';
import { useAccountLoginStore } from '../store/accountLoginStore';
import { useLoginFlowStore } from '../store/loginFlowStore';
import LoginFlow, { type Step } from '../components/LoginFlow';
import PageHeader from '../components/PageHeader';
import { track } from '../utils/track';
import { GOKEZ_SUPPORT } from '../constants/gokezSupport';
import { buildReferralLink, normalizeReferralCode } from '../utils/referral';
import { openReferralLogin } from '../utils/referralLogin';
import { buildWhatsAppLink } from '../utils/whatsapp';
import { readTrackingTokens } from '../utils/guestTracking';

const GUEST_MARKETING_CONSENT_KEY = 'mart_guest_marketing_consent';

interface AccountPageProps {
  storeName?: string;
  storeAddress?: string;
  supportName?: string;
  supportPhone?: string;
  whatsappNumber?: string;
  onNavigate?: (view: string) => void;
}

function WhatsAppIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className={className}>
      <path d="M12.04 2a9.85 9.85 0 0 0-8.35 15.08L2.5 21.5l4.55-1.13A9.85 9.85 0 1 0 12.04 2Zm0 17.9a8 8 0 0 1-4.08-1.12l-.3-.18-2.7.67.72-2.62-.2-.32a8 8 0 1 1 6.56 3.57Zm4.4-5.98c-.24-.12-1.42-.7-1.64-.77-.22-.08-.38-.12-.54.12-.16.24-.62.77-.76.93-.14.16-.28.18-.52.06a6.55 6.55 0 0 1-1.93-1.19 7.23 7.23 0 0 1-1.34-1.67c-.14-.24 0-.37.1-.49.1-.1.22-.26.32-.39.11-.12.14-.22.22-.36.07-.14.03-.27-.02-.38-.06-.1-.54-1.3-.74-1.78-.2-.47-.4-.4-.54-.4h-.46c-.16 0-.42.06-.64.3-.22.24-.84.82-.84 2s.86 2.32.98 2.48c.12.16 1.7 2.6 4.12 3.64.57.25 1.02.4 1.37.51.58.18 1.1.15 1.51.09.46-.07 1.42-.58 1.62-1.14.2-.56.2-1.04.14-1.14-.06-.1-.22-.16-.46-.28Z" />
    </svg>
  );
}

function formatReferralRupees(value: number | string | null | undefined): string {
  const n = Number(value);
  const rounded = Number.isFinite(n) ? n : 0;
  return `₹${Number.isInteger(rounded) ? rounded.toFixed(0) : rounded.toFixed(2)}`;
}

export default function AccountPage({ storeName, storeAddress, supportPhone, whatsappNumber }: AccountPageProps) {
  const { isLoggedIn } = useCustomerAuthStore();
  const { isDark, toggle } = useThemeStore();
  const accountLoginOpen = useAccountLoginStore(s => s.open);
  const openLogin = useAccountLoginStore(s => s.openLogin);
  const closeLogin = useAccountLoginStore(s => s.closeLogin);

  const [locationPermission, setLocationPermission] = useState<string>('prompt');
  // Shared with the navbar picker and the catalog loader: toggling this actually
  // runs the same location lookup the navbar uses, so it switches delivery area
  // immediately instead of waiting for a reload.
  const autoDetect = useZoneStore(s => s.autoDetect);
  const selectedZone = useZoneStore(s => s.selectedZone);
  const locationBusy = useZoneStore(s => s.locating);
  const [locationNotice, setLocationNotice] = useState<string | null>(null);
  const [notificationPermission, setNotificationPermission] = useState(
    isNativePush() ? (hasNativePushToken() ? 'granted' : 'default') : isPushSupported() ? getNotificationPermission() : 'unsupported',
  );
  const [notificationSubscribed, setNotificationSubscribed] = useState(hasNativePushToken());
  const [notificationsBusy, setNotificationsBusy] = useState(false);
  const [notificationNotice, setNotificationNotice] = useState('');
  const [marketingConsent, setMarketingConsent] = useState(false);
  const [shareNotice, setShareNotice] = useState('');
  const [referralData, setReferralData] = useState<ReferralMeData | null>(null);
  // Offered on phones until the app is actually installed to the home screen.

  // "Suggest products" — a lightweight demand form opened in a sheet. Kept local
  // to this page; the ask itself is what matters, not where it was captured.
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [suggestText, setSuggestText] = useState('');
  const [suggestDetail, setSuggestDetail] = useState('');
  const [suggestConsent, setSuggestConsent] = useState(true);
  const [suggestBusy, setSuggestBusy] = useState(false);
  const [suggestError, setSuggestError] = useState('');
  const [suggestDone, setSuggestDone] = useState(false);

  const handleSuggestSubmit = async () => {
    const product = suggestText.trim();
    if (!product) { setSuggestError('Please tell us what you would like us to stock.'); return; }
    setSuggestBusy(true);
    setSuggestError('');
    try {
      await suggestionApi.submit({
        suggestedProduct: product,
        detail: suggestDetail.trim() || undefined,
        zoneId: selectedZone?.id ?? null,
        zoneName: selectedZone?.name ?? null,
        storeId: selectedZone?.storeId ?? null,
        storeName: storeName ?? null,
        contactConsent: suggestConsent,
      });
      setSuggestDone(true);
      track('suggest_product_submitted');
    } catch (err: unknown) {
      setSuggestError(
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error
          || 'Could not send your suggestion. Please try again.'
      );
    } finally {
      setSuggestBusy(false);
    }
  };

  const closeSuggest = () => {
    setSuggestOpen(false);
    setSuggestDone(false);
    setSuggestText('');
    setSuggestDetail('');
    setSuggestError('');
  };

  const handleShareReferral = async () => {
    const shareLink = buildReferralLink(normalizeReferralCode(referralData?.code), window.location.origin);
    if (!shareLink) return;
    let copied = false;
    try {
      await navigator.clipboard.writeText(shareLink);
      copied = true;
    } catch {
      // Fall through to the native share sheet or retry copying below.
    }
    if (copied) {
      setShareNotice('Link copied');
      window.setTimeout(() => setShareNotice(''), 2500);
    }
    if (navigator.share) {
      try {
        await navigator.share({
          title: 'Refer & Earn',
          text: `Use my referral code ${normalizeReferralCode(referralData?.code)} on Gokez Mart.`,
          url: shareLink,
        });
        return;
      } catch (err) {
        if ((err as { name?: string })?.name === 'AbortError') return;
      }
    }
    if (!copied) {
      try {
        await navigator.clipboard.writeText(shareLink);
        setShareNotice('Link copied');
        window.setTimeout(() => setShareNotice(''), 2500);
      } catch {
        setShareNotice('Could not copy. Please select the text and copy it manually.');
        window.setTimeout(() => setShareNotice(''), 2500);
      }
    }
  };

  useEffect(() => {
    getLocationPermission().then(setLocationPermission);
  }, []);


  // Suggestion sheet: same Escape + scroll-lock contract as the install viewer.
  useEffect(() => {
    if (!suggestOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      closeSuggest();
    };
    document.addEventListener('keydown', onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
    };
  }, [suggestOpen]);

  useEffect(() => {
    if (!isLoggedIn) {
      setReferralData(null);
      return;
    }
    let cancelled = false;
    referralApi.getMe().then((response) => {
      if (!cancelled) setReferralData(response.data.data);
    }).catch(() => {
      if (!cancelled) setReferralData(null);
    });
    return () => { cancelled = true; };
  }, [isLoggedIn]);

  useEffect(() => {
    if (!isLoggedIn) {
      setReferralData(null);
      return;
    }
    let cancelled = false;
    referralApi.getMe().then((response) => {
      if (!cancelled) setReferralData(response.data.data);
    }).catch(() => {
      if (!cancelled) setReferralData(null);
    });
    return () => { cancelled = true; };
  }, [isLoggedIn]);

  useEffect(() => {
    const refreshNotificationPermission = () => setNotificationPermission(
      isNativePush() ? (hasNativePushToken() ? 'granted' : 'default') : isPushSupported() ? getNotificationPermission() : 'unsupported',
    );
    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') refreshNotificationPermission();
    };
    refreshNotificationPermission();
    window.addEventListener('focus', refreshNotificationPermission);
    document.addEventListener('visibilitychange', refreshWhenVisible);
    return () => {
      window.removeEventListener('focus', refreshNotificationPermission);
      document.removeEventListener('visibilitychange', refreshWhenVisible);
    };
  }, []);

  useEffect(() => {
    if (isNativePush()) {
      setNotificationSubscribed(hasNativePushToken());
    } else {
      setNotificationSubscribed(false);
    }
    if (!isLoggedIn) {
      try {
        setMarketingConsent(localStorage.getItem(GUEST_MARKETING_CONSENT_KEY) === 'true');
      } catch {
        setMarketingConsent(false);
      }
      if (!isNativePush()) {
        hasActivePushSubscription().then(setNotificationSubscribed).catch(() => setNotificationSubscribed(false));
      }
      return;
    }

    authApi.getMarketingConsent().then(response => setMarketingConsent(response.data.data.granted)).catch(() => {});
    if (isNativePush()) return;
    try {
      if (typeof Notification !== 'undefined' && Notification.permission === 'granted' && 'serviceWorker' in navigator) {
        navigator.serviceWorker.ready
          .then(registration => registration.pushManager.getSubscription())
          .then(subscription => setNotificationSubscribed(!!subscription))
          .catch(() => {});
      }
    } catch {}
  }, [isLoggedIn]);

  const handleLocationToggle = async () => {
    setLocationNotice(null);
    const store = useZoneStore.getState();
    if (store.autoDetect) {
      store.setAutoDetect(false);
      return;
    }
    // Enabling runs the shared lookup right away. It can never block ordering —
    // if the fix can't be matched to an area, the customer just picks one from
    // the navbar dropdown (e.g. ordering for family in another area).
    store.setAutoDetect(true);
    const result = await store.detectAndApply();
    switch (result.status) {
      case 'applied':
      case 'kept':
        setLocationNotice(`Delivering to ${result.zone.name}`);
        break;
      case 'no_match':
        setLocationNotice('No nearby area detected — pick one from the dropdown. You can order to any available area.');
        break;
      case 'denied':
        setLocationNotice('Location is blocked in your settings.');
        break;
      case 'unavailable':
        setLocationNotice('Could not get your location. You can still pick an area from the dropdown.');
        break;
      case 'error':
        setLocationNotice('Something went wrong. Please try again or pick an area from the dropdown.');
        break;
      case 'busy':
        break;
    }
  };

  const handleOrderNotifications = async () => {
    // Tapping the toggle is the "direct enable" path: request permission (or
    // skip the prompt if already granted) and subscribe this device. Guests and
    // members both register for real; subscribeToPush picks the right endpoint.
    // Every step is guarded so a hung worker or a dismissed prompt can never
    // leave the switch stuck half-way (which previously needed a second tap).
    if (notificationsBusy) return;
    setNotificationsBusy(true);
    setNotificationNotice('');

    if (isNativePush()) {
      try {
        if (notificationSubscribed) {
          await clearNativePushAssociation();
          setNotificationSubscribed(false);
          setNotificationNotice('Order updates turned off.');
        } else {
          const granted = await requestNativePushPermission();
          setNotificationPermission(granted ? 'granted' : 'denied');
          setNotificationSubscribed(granted && hasNativePushToken());
          setNotificationNotice(granted ? 'Order updates enabled.' : 'Notifications are blocked. Enable them in your device settings.');
        }
      } catch {
        setNotificationNotice('Could not update notifications. Please try again.');
      } finally {
        setNotificationsBusy(false);
      }
      return;
    }

    const subscribeWithRetry = async () => {
      // First attempt can fail while a freshly registered worker is settling or
      // right after the permission dialog closes; one quiet retry makes the
      // single tap reliable without asking the customer to toggle again.
      let subscribed = await subscribeToPush();
      if (!subscribed) {
        await new Promise(resolve => setTimeout(resolve, 700));
        subscribed = await subscribeToPush();
      }
      setNotificationSubscribed(subscribed);
      if (!subscribed) {
        setNotificationNotice('Could not enable updates on this device. Please try again.');
      }
    };

    try {
      if (notificationPermission === 'granted') {
        if (notificationSubscribed) {
          await unsubscribeFromPush();
          setNotificationSubscribed(false);
        } else {
          await subscribeWithRetry();
        }
        return;
      }
      if (!isPushSupported()) {
        setNotificationPermission('unsupported');
        return;
      }
      const permission = await requestNotificationPermission();
      setNotificationPermission(permission);
      if (permission === 'granted') {
        await subscribeWithRetry();
      } else if (permission === 'denied') {
        setNotificationNotice('Notifications are blocked. Enable them in your browser settings.');
      } else {
        setNotificationNotice('Notifications were not enabled. Try again when you are ready.');
      }
    } catch {
      setNotificationNotice('Turning on notifications took too long. Please try again.');
    } finally {
      setNotificationsBusy(false);
    }
  };

  const handleMarketingNotifications = async () => {
    const next = !marketingConsent;
    setMarketingConsent(next);
    if (!isLoggedIn) {
      const tokens = readTrackingTokens();
      const trackingToken = tokens[tokens.length - 1];
      try {
        if (trackingToken) await authApi.updateGuestMarketingConsent(trackingToken, next);
        localStorage.setItem(GUEST_MARKETING_CONSENT_KEY, String(next));
      } catch { setMarketingConsent(!next); }
      return;
    }
    try { await authApi.updateMarketingConsent(next); }
    catch { setMarketingConsent(!next); }
  };

  // Declining login returns to the page this visit started from: the tab the
  // customer tapped, or '/orders' for the guest "Track My Orders" CTA. It used
  // to branch on cartCount, which sent people to Checkout or Home regardless of
  // where they actually were.
  const loginStep = useRef<Step>('phone');
  // Mirrors loginStep so the green header can render the heading for the current
  // step (the phone step hands its heading over to the page).
  const [loginStepView, setLoginStepView] = useState<Step>('phone');
  // Bumped by the OTP app bar's back chevron to ask LoginFlow to return to the
  // phone step (the bar is page chrome, so it cannot reach the flow's step state).
  const [loginBackSignal, setLoginBackSignal] = useState(0);
  const [brandImgError, setBrandImgError] = useState(false);
  const [logoImgError, setLogoImgError] = useState(false);
  const loginHeaderRef = useRef<HTMLDivElement>(null);
  const formAreaRef = useRef<HTMLDivElement>(null);
  const formContentRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (isLoggedIn || !accountLoginOpen) return;
    const area = formAreaRef.current;
    const content = formContentRef.current;
    if (!area || !content) return;
    const measure = () => {
      const headerHeight = loginHeaderRef.current?.getBoundingClientRect().height ?? 0;
      area.style.setProperty('--login-header-height', `${Math.max(0, Math.round(headerHeight))}px`);
      const button = area.querySelector<HTMLElement>('form button[type="submit"]');
      if (!button) return;
      const buttonRect = button.getBoundingClientRect();
      const offset = buttonRect.top + buttonRect.height / 2 - content.getBoundingClientRect().top;
      area.style.setProperty('--login-button-offset', `${Math.max(0, Math.round(offset))}px`);
    };
    measure();
    const observer = new MutationObserver(measure);
    observer.observe(area, { childList: true, subtree: true, characterData: true });
    const header = loginHeaderRef.current;
    const headerObserver = header && typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    if (header) headerObserver?.observe(header);
    window.addEventListener('resize', measure);
    return () => {
      observer.disconnect();
      headerObserver?.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [isLoggedIn, accountLoginOpen, loginStepView]);

  const leaveAsGuest = () => {
    // The guest escape is keyboard-only now, but it still has to report the
    // abandonment or the hub funnel would miss it on this page.
    if (loginStep.current === 'phone' || loginStep.current === 'otp') {
      track('login_abandoned', { step: loginStep.current, reason: 'guest' });
    }
    const { guestReturnPath } = useLoginFlowStore.getState();
    useLoginFlowStore.getState().clear();
    useLoginFlowStore.getState().setGuestReturnPath(null);
    useLoginFlowStore.getState().setPostLoginPath(null);
    closeLogin();
    navigate(guestReturnPath || '/account');
  };

  const navigate = (path: string) => {
    window.history.pushState({}, '', path);
    window.dispatchEvent(new PopStateEvent('popstate'));
  };

  const footer = (
    <div className="mt-2 flex flex-col items-center gap-1.5">
      <span className="text-xs text-gray-500 dark:text-slate-400">
        A product of{' '}
        <span className="font-bold text-black dark:text-white">
          Gokez Technologies Pvt. Ltd.
        </span>
        {' '}&copy; {new Date().getFullYear()}
      </span>
    </div>
  );

  useEffect(() => {
    const scroller = document.querySelector<HTMLElement>('.app-scroll');
    if (!isLoggedIn && accountLoginOpen) {
      document.body.style.overflow = 'hidden';
      if (scroller) scroller.style.overflow = 'hidden';
      return () => { document.body.style.overflow = ''; if (scroller) scroller.style.overflow = ''; };
    }
    document.body.style.overflow = '';
    if (scroller) scroller.style.overflow = '';
    return undefined;
  }, [isLoggedIn, accountLoginOpen]);

  if (!isLoggedIn && accountLoginOpen) {
    // The phone step gets the tall green hero. The OTP step uses a pale green base with a
    // slim app bar and back chevron (page chrome that nudges the flow back via
    // loginBackSignal). Profile/offer stay plain pale green.
    const showBrandHeader = loginStepView === 'phone';
    const showOtpHeader = loginStepView === 'otp';
    return (
      <div className="page-shell login-page-view login-brand-bg relative flex h-full flex-col overflow-hidden font-sans dark:bg-slate-900">
        {showOtpHeader && (
          <div ref={loginHeaderRef} className="shrink-0">
            <PageHeader
              onBack={() => setLoginBackSignal((n) => n + 1)}
              backLabel="Back to mobile number"
              position="static"
              gradient="r"
              darkTo="#18191a"
            />
          </div>
        )}
        {showBrandHeader && (
          <div ref={loginHeaderRef} className="login-brand-hero relative z-10 w-full shrink-0 text-left">
            <div className="login-brand-header relative flex items-center justify-start">
              <div className="mx-auto w-full max-w-sm px-4 sm:px-6">
                <div className="flex min-w-0 -translate-y-5 flex-col items-start">
                  <div className="flex items-end justify-start gap-0">
                    {logoImgError ? (
                      <Home className="login-brand-logo flex-shrink-0 text-[#087A43] dark:text-green-400" aria-hidden="true" />
                    ) : (
                      <img
                        src="/gokez_mart_logo-header.png"
                        alt=""
                        className="login-brand-logo flex-shrink-0 object-contain"
                        onError={() => setLogoImgError(true)}
                      />
                    )}
                    {brandImgError ? (
                      <span className="login-brand-fallback font-extrabold leading-none tracking-tight text-[#087A43] dark:text-green-400">Gokez Mart</span>
                    ) : (
                      <img
                        src="/mart_brand_new.webp"
                        alt="Gokez Mart"
                        className="login-brand-image"
                        onError={() => setBrandImgError(true)}
                      />
                    )}
                  </div>
                  <p className="login-brand-tagline text-left font-bold leading-none tracking-tight text-black">Shop Local. Support Local.</p>
                  <p className="login-punchline w-full text-left font-black leading-tight tracking-tight text-black">
                    Your local shops,<br />
                    now delivered in minutes.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={leaveAsGuest}
                className="absolute -top-2 right-[calc(env(safe-area-inset-right,0px)+1rem)] inline-flex min-h-9 items-center gap-0.5 rounded-full bg-[#9AEFAF] px-3 text-xs font-bold text-[#087A43] shadow-sm ring-1 ring-[#087A43]/20 transition-colors hover:bg-[#8CE6A3] active:bg-[#7EDD96] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#087A43] focus-visible:ring-offset-2 dark:bg-[#9AEFAF] dark:text-[#087A43] dark:ring-[#087A43]/20 sm:-top-1 sm:right-[calc(env(safe-area-inset-right,0px)+1.5rem)] sm:min-h-10 sm:px-4 sm:text-sm"
              >
                Skip<ChevronRight className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
          </div>
        )}
        <div ref={formAreaRef} className="login-form-area relative min-h-0 w-full flex-1 overflow-y-auto">
          <div className="flex min-h-full flex-col">
            <div className="login-form-spacer" aria-hidden="true" />
            <div ref={formContentRef} className={`mx-auto w-full max-w-sm px-4 sm:px-6 ${
              showBrandHeader
                ? 'pb-[calc(1.5rem+env(safe-area-inset-bottom,0px))] pt-3'
                : showOtpHeader
                  ? 'space-y-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-6'
                  : 'space-y-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-2'
            }`}>
            {showBrandHeader && <h1 className="mb-0 text-center text-[18px] font-black text-gray-900 dark:text-white">Log in or Sign up</h1>}
            <div className={showBrandHeader ? "-mt-2" : undefined}>
<LoginFlow
              variant="page"
              showPhoneHeading={false}
              backSignal={loginBackSignal}
              // Deliberately NOT pendingCheckout={cartCount > 0}. That flag is
              // persisted by beginOtp and read back on boot to auto-open the
              // overlay, so setting it here would turn any reload of /account
              // mid-login into the checkout modal, and it would label the name
              // step "Continue to Checkout" when this page actually navigates to
              // postLoginPath (/orders). The hero image is supplied by the flow
              // so both hosts share one login visual.
              onStepChange={(s) => { loginStep.current = s; setLoginStepView(s); }}
              onNavigateLegal={(path) => { closeLogin(); navigate(path); }}
              // Escape is the only guest exit here, so the page has to do the
              // flow's cleanup itself. LoginFlow.handleGuest normally calls
              // loginFlow.clear() before leaving; without that, a shopper who
              // abandons login here leaves an unexpired OTP flow in sessionStorage,
              // which App reads on next boot and turns into a surprise modal.
              onGuest={leaveAsGuest}
              onSuccess={() => {
                // Honour an explicit redirect intent (for example, Orders). A
                // customer who began login from Account belongs back on Account.
                const redirect = useLoginFlowStore.getState().postLoginPath || '/account';
                useLoginFlowStore.getState().setPostLoginPath(null);
                useLoginFlowStore.getState().setGuestReturnPath(null);
                closeLogin();
                navigate(redirect);
              }}
              onClose={closeLogin}
            />
            </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="page-shell bg-[#f7f8fa] dark:bg-slate-900 font-sans">
      <div className={`mx-auto max-w-2xl space-y-7 px-4 pb-10 sm:px-6 sm:pb-7 ${isLoggedIn ? 'py-5 sm:py-7' : 'pt-0'}`}>
        {/* Sticky under the fixed header band: the prompt stays pinned at
            top-0 of the scroller while the account options scroll beneath
            it, so "Log in / Continue login" is always one tap away. The
            band lives outside the scroller, so top-0 pins directly below
            it — no offset math. No negative top margin: the old -mt-5
            tucked the card under the in-flow header, which no longer
            exists; the page drops its top padding for guests so the card sits
            flush under the header, and when pinned the solid bg + border-y + shadow separate it
            from the content scrolling under. z-30 keeps it below the
            band's z-40. */}
        {!isLoggedIn && (
        <div className="sticky top-0 z-30 -mx-4 overflow-hidden rounded-none border-y border-cream-200 bg-white px-4 pb-4 pt-2 shadow-[0_2px_10px_rgba(23,32,51,0.04)] dark:border-slate-700 dark:bg-slate-800 sm:px-6">
          <div className="min-w-0">
              <p className="text-sm font-semibold text-center text-gray-500 dark:text-slate-400">Log in or sign up to access your complete account.</p>
              <button type="button" onClick={openLogin} className="mt-3 flex min-h-11 w-full items-center justify-center rounded-md bg-gray-800 px-3 text-sm font-semibold text-white transition-colors hover:bg-gray-900 dark:bg-gokez-700 dark:hover:bg-gokez-800">Continue login</button>
          </div>
        </div>
        )}

        {!isLoggedIn && (
          <section
            role="button"
            aria-label="Refer and Earn - log in"
            tabIndex={0}
            onClick={() => openReferralLogin('/account')}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                openReferralLogin('/account');
              }
            }}
            className="cursor-pointer rounded-[18px] border border-gokez-200 bg-white p-4 shadow-[0_2px_10px_rgba(23,32,51,0.03)] transition-colors hover:border-gokez-300 dark:border-gokez-800 dark:bg-slate-800 dark:hover:border-gokez-700"
          >
            <div className="flex items-stretch gap-3">
              <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl bg-gokez-50 dark:bg-gokez-900/30">
                <Gift className="h-5 w-5 text-gokez-700 dark:text-gokez-400" aria-hidden="true" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[15px] font-bold leading-snug text-ink dark:text-white">Refer &amp; Earn</p>
                <p className="mt-1 text-xs font-medium text-gray-500 dark:text-slate-400 sm:text-sm">
                  Log in to get your referral code and start earning rewards.
                </p>
              </div>
            </div>
          </section>
        )}

        {isLoggedIn && (
          <section className="rounded-[18px] border border-gokez-200 bg-white p-4 shadow-[0_2px_10px_rgba(23,32,51,0.03)] dark:border-gokez-800 dark:bg-slate-800">
            <div className="flex items-center gap-2 sm:gap-3">
              <div className="hidden h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl bg-gokez-50 dark:bg-gokez-900/30 min-[360px]:flex">
                <Gift className="h-5 w-5 text-gokez-700 dark:text-gokez-400" aria-hidden="true" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex min-w-0 items-center gap-1.5">
                  <p className="truncate text-[15px] font-bold leading-snug text-ink dark:text-white">Refer &amp; Earn</p>
                  <span className="shrink-0 rounded-full bg-amber-400 px-2 py-0.5 font-mono text-xs font-bold text-black dark:bg-amber-300 dark:text-black">
                    {normalizeReferralCode(referralData?.code) || '—'}
                  </span>
                </div>
                <p className="mt-1 truncate text-xs font-medium text-ink dark:text-white sm:text-sm">
                  Redeemable referral balance:
                  <span className="ml-1 inline-flex rounded-full bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-800 dark:bg-amber-900/30 dark:text-amber-300">
                    {formatReferralRupees(referralData?.stats?.redeemableNow ?? referralData?.stats?.available ?? 0)}
                  </span>
                </p>
              </div>
              <div className="flex w-16 flex-shrink-0 flex-col items-stretch gap-1 sm:w-20">
                <button
                  type="button"
                  onClick={() => void handleShareReferral()}
                  className="flex min-h-8 items-center justify-center gap-0.5 rounded-xl bg-gray-900 px-1 text-sm font-extrabold text-white transition-colors hover:bg-black dark:bg-gokez-700 dark:hover:bg-gokez-800 sm:min-h-9 sm:px-2 sm:text-base"
                >
                  <Share className="h-4 w-4" aria-hidden="true" /> Share
                  <span className="sr-only">{buildReferralLink(normalizeReferralCode(referralData?.code), window.location.origin)}</span>
                </button>
                <button
                  type="button"
                  onClick={() => navigate('/referrals')}
                  className="whitespace-nowrap text-center text-[11px] font-bold leading-none text-gray-500 transition-colors hover:text-gray-700 dark:text-slate-300 dark:hover:text-slate-100 sm:text-xs"
                >
                  View details
                </button>
              </div>
            </div>
            {shareNotice && <p className="mt-2 text-[11px] font-medium text-gokez-700 dark:text-gokez-300" role="status">{shareNotice}</p>}
          </section>
        )}

        <section>
          <div className="grid grid-cols-3 gap-2">
            <a href={`mailto:${GOKEZ_SUPPORT.email}`} className="flex min-h-[68px] flex-col items-center justify-center gap-1.5 rounded-xl border border-cream-200 bg-white px-2 py-2 text-center text-xs font-semibold text-ink shadow-[0_2px_10px_rgba(23,32,51,0.03)] transition-colors hover:border-gokez-300 dark:border-slate-700 dark:bg-slate-800 dark:text-white">
              <Headphones className="h-5 w-5 text-blue-600 dark:text-blue-400" aria-hidden="true" />
              <span>Support</span>
            </a>
            <button type="button" onClick={() => navigate('/feedback/')} className="flex min-h-[68px] flex-col items-center justify-center gap-1.5 rounded-xl border border-cream-200 bg-white px-2 py-2 text-center text-xs font-semibold text-ink shadow-[0_2px_10px_rgba(23,32,51,0.03)] transition-colors hover:border-gokez-300 dark:border-slate-700 dark:bg-slate-800 dark:text-white">
              <MessageSquare className="h-5 w-5 text-amber-600 dark:text-amber-400" aria-hidden="true" />
              <span>Feedback</span>
            </button>
            <button type="button" onClick={() => setSuggestOpen(true)} className="flex min-h-[68px] flex-col items-center justify-center gap-1.5 rounded-xl border border-cream-200 bg-white px-2 py-2 text-center text-xs font-semibold text-ink shadow-[0_2px_10px_rgba(23,32,51,0.03)] transition-colors hover:border-gokez-300 dark:border-slate-700 dark:bg-slate-800 dark:text-white">
              <Sparkles className="h-5 w-5 text-gokez-700 dark:text-gokez-400" aria-hidden="true" />
              <span>Suggest product</span>
            </button>
          </div>
          {shareNotice && <p className="mt-2 text-center text-[11px] font-medium text-gokez-700 dark:text-gokez-400" role="status">{shareNotice}</p>}
        </section>



        {(storeName || storeAddress || supportPhone || whatsappNumber) && (
          <section>
            <p className="mb-3 px-1 text-xs font-bold uppercase tracking-[0.05em] text-gray-500 dark:text-slate-400">Your local store</p>
            <div className="rounded-[18px] border border-cream-200 bg-white p-4 shadow-[0_2px_10px_rgba(23,32,51,0.03)] dark:border-slate-700 dark:bg-slate-800">
              <div className="flex items-center gap-3">
                <div className="h-11 w-11 flex-shrink-0 overflow-hidden rounded-xl bg-gokez-50 dark:bg-gokez-900/30">
                  <img src="/store_pic.webp" alt={storeName || 'Store'} className="h-full w-full object-cover" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[15px] font-semibold text-ink dark:text-white">{storeName || 'Your delivery store'}</p>
                  {storeAddress && <p className="mt-0.5 text-xs text-gray-500 dark:text-slate-400">({storeAddress})</p>}
                  <p className="mt-0.5 text-[13px] text-gray-500 dark:text-slate-400">
                    {storeName ? 'Your orders are fulfilled by this store.' : 'Order and delivery help'}
                  </p>
                </div>
              </div>
              {(supportPhone || whatsappNumber) && (
                <div className="mt-4 flex gap-2 border-t border-cream-200 pt-3 dark:border-slate-700">
                  {supportPhone && (
                    <a href={`tel:${supportPhone}`}
                      className="flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-xl border border-cream-200 bg-white text-xs font-semibold text-ink shadow-[0_2px_10px_rgba(23,32,51,0.03)] transition-colors hover:border-blue-300 dark:border-slate-700 dark:bg-slate-800 dark:text-white dark:hover:border-blue-500/60">
                      <Phone className="w-4 h-4 text-blue-600 dark:text-blue-400" /> Call store
                    </a>
                  )}
                  {whatsappNumber && (
                    <a href={buildWhatsAppLink(whatsappNumber, 'Hi, I need help with my order on Gokez Mart.')}
                      target="_blank" rel="noopener noreferrer"
                      className="flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-xl border border-cream-200 bg-white text-xs font-semibold text-ink shadow-[0_2px_10px_rgba(23,32,51,0.03)] transition-colors hover:border-green-300 dark:border-slate-700 dark:bg-slate-800 dark:text-white dark:hover:border-green-500/60">
                      <WhatsAppIcon className="h-4 w-4 text-green-600 dark:text-green-400" /> WhatsApp
                    </a>
                  )}
                </div>
              )}
            </div>
          </section>
        )}

        <section>
        <p className="mb-3 px-1 text-xs font-bold uppercase tracking-[0.05em] text-gray-500 dark:text-slate-400">Preferences</p>
        <div className="overflow-hidden rounded-[18px] border border-cream-200 bg-white shadow-[0_2px_10px_rgba(23,32,51,0.03)] dark:border-slate-700 dark:bg-slate-800 divide-y divide-cream-200 dark:divide-slate-700">
          <div className="flex min-h-[64px] items-center gap-3 px-4">
            {isDark
              ? <Sun className="w-4 h-4 text-amber-500 flex-shrink-0" />
              : <Moon className="w-4 h-4 text-indigo-500 flex-shrink-0" />}
            <div className="flex-1 min-w-0">
              <span className="text-[15px] font-semibold text-ink dark:text-slate-200">Dark mode</span>
              <p className="text-[12px] text-gray-500 dark:text-slate-400">
                {isDark ? 'On — using the dark theme' : 'Off — using the light theme'}
              </p>
            </div>
            <button onClick={toggle} role="switch" aria-checked={isDark} aria-label="Toggle dark mode"
              className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none ${isDark ? 'bg-gokez-700' : 'bg-gray-200 dark:bg-slate-600'}`}>
              <span className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${isDark ? 'translate-x-5' : 'translate-x-0'}`} />
            </button>
          </div>
          <div className="flex min-h-[64px] items-center gap-3 px-4">
            <Navigation className="w-4 h-4 text-blue-500 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <span className="text-[15px] font-semibold text-ink dark:text-slate-200">Location</span>
              <p className="text-[12px] text-gray-500 dark:text-slate-400">
                {locationNotice ?? (locationPermission === 'denied'
                  ? 'Blocked in browser — enable in browser settings'
                  : autoDetect
                  ? selectedZone
                    ? `Auto-detects — delivering to ${selectedZone.name}`
                    : 'Auto-detects your delivery zone'
                  : 'Off — select zone manually from dropdown')}
              </p>
            </div>
            {locationPermission === 'denied' ? (
              <span className="text-[10px] font-semibold text-red-500 bg-red-50 dark:bg-red-900/20 px-2 py-1 rounded-lg">Blocked</span>
            ) : (
              <button onClick={handleLocationToggle} role="switch" aria-checked={autoDetect} disabled={locationBusy}
                className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none disabled:opacity-70 ${autoDetect ? 'bg-gokez-700' : 'bg-gray-200 dark:bg-slate-600'}`}>
                <span className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${autoDetect ? 'translate-x-5' : 'translate-x-0'}`} />
              </button>
            )}
          </div>
          <div className="flex min-h-[64px] items-center gap-3 px-4">
            <Bell className="w-4 h-4 text-gokez-500 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <span className="text-[15px] font-semibold text-ink dark:text-slate-200">Order notifications</span>
              <p className={`text-[12px] ${notificationNotice ? 'text-red-600 dark:text-red-400' : 'text-gray-500 dark:text-slate-400'}`}>
                {notificationsBusy
                  ? (notificationSubscribed ? 'Turning off…' : 'Turning on…')
                  : notificationNotice ||
                    (notificationPermission === 'granted' ? (notificationSubscribed ? 'On - delivery and order alerts' : 'Permission granted - enable alerts') :
                     notificationPermission === 'denied' ? 'Blocked - enable in browser settings' :
                     notificationPermission === 'unsupported' ? 'Not supported on this browser' :
                     'Get delivery and order status alerts')}
              </p>
            </div>
            {notificationPermission === 'denied' ? (
              <span className="text-[10px] font-semibold text-red-500 bg-red-50 dark:bg-red-900/20 px-2 py-1 rounded-lg">Blocked</span>
            ) : notificationPermission === 'unsupported' ? (
              <span className="text-[10px] font-semibold text-gray-500 bg-gray-100 dark:bg-slate-700 px-2 py-1 rounded-lg">N/A</span>
            ) : (
              <button onClick={handleOrderNotifications} role="switch" aria-checked={notificationSubscribed} aria-label="Toggle order notifications"
                disabled={notificationsBusy}
                className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${notificationSubscribed ? 'bg-gokez-700' : 'bg-gray-200 dark:bg-slate-600'}`}>
                <span className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow transition duration-200 ${notificationSubscribed ? 'translate-x-5' : 'translate-x-0'}`} />
              </button>
            )}
          </div>
          <div className="flex min-h-[64px] items-center gap-3 px-4">
            <MessageCircle className="w-4 h-4 text-amber-500 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <span className="text-[15px] font-semibold text-ink dark:text-slate-200">Promotional notifications</span>
              <p className="text-[12px] text-gray-500 dark:text-slate-400">{isLoggedIn ? 'Offers, deals and new arrivals' : 'Preference saved on this device'}</p>
            </div>
            <button onClick={handleMarketingNotifications} role="switch" aria-checked={marketingConsent} aria-label="Toggle promotional notifications"
              className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${marketingConsent ? 'bg-gokez-700' : 'bg-gray-200 dark:bg-slate-600'}`}>
              <span className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow transition duration-200 ${marketingConsent ? 'translate-x-5' : 'translate-x-0'}`} />
            </button>
          </div>
        </div>
        </section>

        <section>
        <p className="mb-3 px-1 text-xs font-bold uppercase tracking-[0.05em] text-gray-500 dark:text-slate-400">More info</p>
        <div className="overflow-hidden rounded-[18px] border border-cream-200 bg-white shadow-[0_2px_10px_rgba(23,32,51,0.03)] dark:border-slate-700 dark:bg-slate-800">
          <button onClick={() => navigate('/about/')} className="flex min-h-[56px] w-full items-center gap-3 px-4 text-left transition-colors hover:bg-gray-50 dark:hover:bg-slate-700/50">
            <Info className="h-4 w-4 text-gray-500 dark:text-slate-400" />
            <span className="flex-1 text-[15px] font-medium text-ink dark:text-slate-300">About</span>
            <ChevronRight className="h-4 w-4 text-gray-300" />
          </button>
          <button onClick={() => navigate('/grievance/')} className="flex min-h-[56px] w-full items-center gap-3 border-t border-cream-200 px-4 text-left transition-colors hover:bg-gray-50 dark:border-slate-700 dark:hover:bg-slate-700/50">
            <MessageCircle className="h-4 w-4 text-gray-500 dark:text-slate-400" />
            <span className="flex-1 text-[15px] font-medium text-ink dark:text-slate-300">Submit a grievance</span>
            <ChevronRight className="h-4 w-4 text-gray-300" />
          </button>
          <button onClick={() => navigate('/privacy/')} className="flex min-h-[56px] w-full items-center gap-3 border-t border-cream-200 px-4 text-left transition-colors hover:bg-gray-50 dark:border-slate-700 dark:hover:bg-slate-700/50">
            <ShieldCheck className="h-4 w-4 text-gray-500 dark:text-slate-400" />
            <span className="flex-1 text-[15px] font-medium text-ink dark:text-slate-300">Privacy policy</span>
            <ChevronRight className="h-4 w-4 text-gray-300" />
          </button>
          <button onClick={() => navigate('/terms/')} className="flex min-h-[56px] w-full items-center gap-3 border-t border-cream-200 px-4 text-left transition-colors hover:bg-gray-50 dark:border-slate-700 dark:hover:bg-slate-700/50">
            <FileText className="h-4 w-4 text-gray-500 dark:text-slate-400" />
            <span className="flex-1 text-[15px] font-medium text-ink dark:text-slate-300">Terms of service</span>
            <ChevronRight className="h-4 w-4 text-gray-300" />
          </button>
        </div>
        </section>

        <section className="pt-1 text-center">
          <p className="mt-6 text-xs text-gray-400 dark:text-slate-500">Version: v0.1.7</p>
          {footer}
        </section>
      </div>

      {/* "Suggest products" sheet. A bottom sheet on phones, centred on larger
          screens. Portalled so it escapes the page scroll container. */}
      {suggestOpen && createPortal(
        <div className="fixed inset-0 z-[90] flex items-end justify-center bg-slate-900/60 backdrop-blur-sm sm:items-center" onClick={closeSuggest}>
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Suggest a product"
            onClick={e => e.stopPropagation()}
            className="w-full max-w-md rounded-t-2xl bg-white p-5 shadow-xl dark:bg-slate-800 sm:rounded-2xl"
          >
            {suggestDone ? (
              <div className="py-4 text-center">
                <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-gokez-50 dark:bg-gokez-900/30">
                  <Sparkles className="h-6 w-6 text-gokez-700 dark:text-gokez-400" aria-hidden="true" />
                </div>
                <p className="mt-3 text-base font-bold text-ink dark:text-white">Thanks for the suggestion!</p>
                <p className="mt-1 text-sm text-gray-500 dark:text-slate-400">We share every request with our team. If we add it, you may see it in the catalog soon.</p>
                <button
                  type="button"
                  onClick={closeSuggest}
                  className="mt-5 w-full rounded-xl bg-gokez-700 px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-gokez-800"
                >
                  Done
                </button>
              </div>
            ) : (
              <>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-base font-bold text-ink dark:text-white">Suggest a product</p>
                    <p className="mt-1 text-xs text-gray-500 dark:text-slate-400">Tell us what you would like us to stock.</p>
                  </div>
                  <button
                    type="button"
                    onClick={closeSuggest}
                    aria-label="Close"
                    className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-gray-500 transition-colors hover:bg-gray-100 dark:text-slate-400 dark:hover:bg-slate-700"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>

                <div className="mt-4 space-y-3">
                  <div>
                    <label htmlFor="suggest-product" className="mb-1 block text-xs font-medium text-gray-500 dark:text-slate-400">Product name</label>
                    <input
                      id="suggest-product"
                      type="text"
                      value={suggestText}
                      maxLength={200}
                      onChange={e => setSuggestText(e.target.value)}
                      placeholder="e.g. Amul butter, Maggi, Dettol soap"
                      autoFocus
                      className="w-full rounded-xl border border-cream-200 bg-white px-3 py-2.5 text-sm text-ink outline-none focus:border-gokez-400 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
                    />
                  </div>
                  <div>
                    <label htmlFor="suggest-detail" className="mb-1 block text-xs font-medium text-gray-500 dark:text-slate-400">Any details? <span className="font-normal">(optional)</span></label>
                    <textarea
                      id="suggest-detail"
                      value={suggestDetail}
                      maxLength={500}
                      rows={2}
                      onChange={e => setSuggestDetail(e.target.value)}
                      placeholder="Brand, size, or anything else that helps…"
                      className="w-full resize-none rounded-xl border border-cream-200 bg-white px-3 py-2.5 text-sm text-ink outline-none focus:border-gokez-400 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
                    />
                  </div>
                  <label className="flex items-start gap-2 text-xs text-gray-500 dark:text-slate-400">
                    <input
                      type="checkbox"
                      checked={suggestConsent}
                      onChange={e => setSuggestConsent(e.target.checked)}
                      className="mt-0.5 h-4 w-4 rounded border-gray-300 text-gokez-700 focus:ring-gokez-500"
                    />
                    <span>Contact me if this product is added.</span>
                  </label>
                  {suggestError && <p className="text-xs font-medium text-red-500" role="alert">{suggestError}</p>}
                </div>

                <div className="mt-5 flex gap-2">
                  <button
                    type="button"
                    onClick={closeSuggest}
                    className="flex-1 rounded-xl border border-cream-200 px-4 py-3 text-sm font-semibold text-ink transition-colors hover:bg-gray-50 dark:border-slate-700 dark:text-white dark:hover:bg-slate-700"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleSuggestSubmit}
                    disabled={suggestBusy}
                    className="flex-1 rounded-xl bg-gokez-700 px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-gokez-800 disabled:opacity-50"
                  >
                    {suggestBusy ? 'Sending…' : 'Submit'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>,
        document.body
      )}

    </div>
  );
}
