import { useState, useEffect, useRef } from 'react';
import { Phone, MessageCircle, Bell, Navigation, ShieldCheck, FileText, ChevronRight, Headphones, MessageSquare, Share2, Moon, Sun, Smartphone, ArrowUpRight } from 'lucide-react';
import { authApi } from '../services/api';
import { useCustomerAuthStore } from '../store/customerAuthStore';
import { useThemeStore } from '../store/themeStore';
import { useZoneStore } from '../store/zoneStore';
import { getLocationPermission, getNotificationPermission, requestNotificationPermission, subscribeToPush, unsubscribeFromPush } from '../services/push';
import { useAccountLoginStore } from '../store/accountLoginStore';
import { useLoginFlowStore } from '../store/loginFlowStore';
import LoginFlow, { type Step } from '../components/LoginFlow';
import PageHeader from '../components/PageHeader';
import { track, trackInstall } from '../utils/track';
import { useInstallGuide } from '../utils/install';
import { BRAND_SLOGAN } from '../constants/brand';
import { GOKEZ_SUPPORT } from '../constants/gokezSupport';

const GUEST_ORDER_NOTIFICATIONS_KEY = 'mart_guest_order_notifications';
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
  const [notificationPermission, setNotificationPermission] = useState(getNotificationPermission());
  const [notificationSubscribed, setNotificationSubscribed] = useState(false);
  const [marketingConsent, setMarketingConsent] = useState(false);
  const [shareNotice, setShareNotice] = useState('');
  // Offered on phones until the app is actually installed to the home screen.
  const installGuide = useInstallGuide();

  useEffect(() => {
    getLocationPermission().then(setLocationPermission);
  }, []);

  useEffect(() => {
    const refreshNotificationPermission = () => setNotificationPermission(getNotificationPermission());
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
    if (!isLoggedIn) {
      try {
        setMarketingConsent(localStorage.getItem(GUEST_MARKETING_CONSENT_KEY) === 'true');
        setNotificationSubscribed(localStorage.getItem(GUEST_ORDER_NOTIFICATIONS_KEY) === 'true');
      } catch {
        setMarketingConsent(false);
        setNotificationSubscribed(false);
      }
      return;
    }

    authApi.getMarketingConsent().then(response => setMarketingConsent(response.data.data.granted)).catch(() => {});
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
        setLocationNotice('Location is blocked in your browser settings.');
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
    if (!isLoggedIn) {
      const next = !notificationSubscribed;
      try { localStorage.setItem(GUEST_ORDER_NOTIFICATIONS_KEY, String(next)); }
      catch { return; }
      setNotificationSubscribed(next);
      return;
    }
    if (notificationPermission === 'granted') {
      if (notificationSubscribed) {
        await unsubscribeFromPush();
        setNotificationSubscribed(false);
      } else {
        setNotificationSubscribed(await subscribeToPush());
      }
      return;
    }
    const permission = await requestNotificationPermission();
    setNotificationPermission(permission);
    if (permission === 'granted') setNotificationSubscribed(await subscribeToPush());
  };

  const handleShareApp = async () => {
    const base = window.location.origin;
    const url = `${base}/`;
    const shareText = 'Shop local. Support local. Order everyday essentials from nearby stores.';
    try {
      let files: File[] | undefined;
      const nav = navigator as any;
      if ('canShare' in nav || nav.share) {
        try {
          const res = await fetch(`${base}/share_app.webp`);
          if (res.ok) {
            const blob = await res.blob();
            if (blob.type.startsWith('image/')) {
              files = [new File([blob], 'share_app.webp', { type: blob.type || 'image/webp' })];
            }
          }
        } catch {
          // ignore
        }
      }

      const shareData: ShareData & { files?: File[] } = {
        title: 'Gokez Mart',
        text: shareText,
        url,
      };
      if (files?.length) shareData.files = files;

      if (nav.share) {
        if (files?.length && nav.canShare && !nav.canShare(shareData)) {
          // skip files if not supported
          delete shareData.files;
        }
        await nav.share(shareData);
        return;
      }
      await navigator.clipboard.writeText(url);
      setShareNotice('Link copied');
      window.setTimeout(() => setShareNotice(''), 2500);
    } catch {
      try {
        await navigator.clipboard.writeText(url);
        setShareNotice('Link copied');
        window.setTimeout(() => setShareNotice(''), 2500);
      } catch {}
    }
  };

  const handleMarketingNotifications = async () => {
    const next = !marketingConsent;
    setMarketingConsent(next);
    if (!isLoggedIn) {
      try { localStorage.setItem(GUEST_MARKETING_CONSENT_KEY, String(next)); }
      catch { setMarketingConsent(!next); }
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

  const leaveAsGuest = () => {
    // The flow's own GuestLink tracks this itself, but showGuestLink is off here,
    // so without emitting it here every abandonment from this page would be
    // invisible in the hub funnel.
    if (loginStep.current === 'phone' || loginStep.current === 'otp') {
      track('login_abandoned', { step: loginStep.current, reason: 'guest' });
    }
    const { guestReturnPath } = useLoginFlowStore.getState();
    useLoginFlowStore.getState().clear();
    useLoginFlowStore.getState().setGuestReturnPath(null);
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

  if (!isLoggedIn && accountLoginOpen) {
    // The phone step gets the tall green hero. The OTP step gets a slim green app
    // bar with a back chevron: the chevron is page chrome (it lives outside the
    // flow and nudges it back via loginBackSignal). Profile/offer stay plain pale
    // green with a header-height gap at the top.
    const showBrandHeader = loginStepView === 'phone';
    const showOtpHeader = loginStepView === 'otp';
    return (
      <div className={`page-shell relative font-sans ${
        showBrandHeader
          ? 'bg-white dark:bg-slate-900'
          : showOtpHeader
            ? 'flex flex-col bg-white dark:bg-slate-900'
            : 'flex flex-col justify-start bg-[#e8f5e9] pt-[64px] dark:bg-slate-900'
      }`}>
        {showBrandHeader && (
          <PageHeader
            onBack={() => {
              const flow = useLoginFlowStore.getState();
              const guestReturnPath = flow.guestReturnPath;
              flow.clear();
              flow.setGuestReturnPath(null);
              closeLogin();
              setLoginStepView('phone');
              navigate(guestReturnPath || '/');
            }}
            backLabel={(() => {
              const { guestReturnPath } = useLoginFlowStore.getState();
              return guestReturnPath ? 'Back to checkout' : 'Back to home';
            })()}
            position="static"
            gradient="r"
            darkTo="#18191a"
          />
        )}
        {showOtpHeader && (
          <PageHeader
            onBack={() => setLoginBackSignal((n) => n + 1)}
            backLabel="Back to mobile number"
            position="static"
            gradient="r"
            darkTo="#18191a"
          />
        )}
        {showBrandHeader && (
          <div className="flex flex-col items-center px-6 pt-7 text-center">
            <img
              src="/mart_brand_new.png"
              alt="Gokez Mart"
              width={1536}
              height={1024}
              className="-mb-3 h-[54px] w-auto object-contain"
            />
            <p className="mt-0 text-[clamp(9px,calc(4vw-6px),29px)] font-bold leading-tight text-slate-900 dark:text-white">{BRAND_SLOGAN}</p>
            <p
              className="mt-[80px] text-center font-black leading-none tracking-tight text-[clamp(12px,3.75vw,28px)] text-slate-900 dark:text-white"
              style={{ marginTop: '5lh' }}
            >
              From your Neighbourhood Store to your door
            </p>
            <h1 className="mt-3 text-[15px] font-black leading-tight text-slate-500 dark:text-slate-400">Log in or sign up</h1>
          </div>
        )}
        <div className={`relative w-full overflow-hidden ${
          showBrandHeader
            ? 'bg-white sm:mx-auto sm:max-w-sm sm:rounded-3xl sm:shadow-xl dark:bg-slate-800'
            : 'sm:mx-auto sm:max-w-sm'
        }`}>
          <div className={showBrandHeader ? "px-5 pb-6 pt-1 space-y-4" : showOtpHeader ? "px-5 pb-6 pt-6 space-y-4" : "px-5 pb-6 pt-2 space-y-4"}>
<LoginFlow
              variant="page"
              showPhoneHeading={false}
              backSignal={loginBackSignal}
              // Deliberately NOT pendingCheckout={cartCount > 0}. That flag is
              // persisted by beginOtp and read back on boot to auto-open the
              // overlay, so setting it here would turn any reload of /account
              // mid-login into the checkout modal, and it would label the name
              // step "Continue to Checkout" when this page actually navigates to
              // postLoginPath (/orders).
              // Only the guest exit is stood down: the page renders its own
              // "Continue as guest" link below, so the flow's copy is switched off
              // to avoid showing the same action twice. The hero image is NOT --
              // the flow supplies it, so both hosts share one login visual.
              showGuestLink={false}
              onStepChange={(s) => { loginStep.current = s; setLoginStepView(s); }}
              onNavigateLegal={(path) => { closeLogin(); navigate(path); }}
              // The page owns the guest exit (the flow's own is switched off above), so it
              // has to do the flow's cleanup itself. LoginFlow.handleGuest normally
              // calls loginFlow.clear() before leaving; without that, a shopper who
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
            {!isLoggedIn && <div className="text-center">
              <button
                onClick={leaveAsGuest}
                className="text-[13px] font-semibold text-emerald-600 dark:text-emerald-400 hover:text-emerald-700 dark:hover:text-emerald-300 transition-colors"
              >
                Continue as guest →
              </button>
            </div>}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="page-shell bg-[#f7f8fa] dark:bg-slate-900 font-sans">
      <div className="mx-auto max-w-2xl space-y-7 px-4 py-5 pb-10 sm:px-6 sm:py-7">
        {!isLoggedIn && (
        <div className="relative -mx-4 -mt-5 overflow-hidden rounded-none border-y border-[#e9edf2] bg-white p-4 shadow-[0_2px_10px_rgba(23,32,51,0.04)] dark:border-slate-700 dark:bg-slate-800 sm:-mx-6 sm:-mt-7">
          <div className="min-w-0">
              <p className="text-lg font-bold leading-tight text-[#172033] dark:text-white">Your account</p>
              <p className="mt-2 text-xs text-[#687386] dark:text-slate-400">Log in or sign up to access complete account.</p>
              <button type="button" onClick={openLogin} className="mt-3 flex min-h-11 w-full items-center justify-center rounded-md bg-[#172033] px-3 text-sm font-semibold text-white transition-colors hover:bg-black dark:bg-white dark:text-[#172033] dark:hover:bg-slate-200">Continue login</button>
          </div>
        </div>
        )}

        <section>
          <div className="grid grid-cols-3 gap-2">
            <a href={`mailto:${GOKEZ_SUPPORT.email}`} className="flex min-h-[68px] flex-col items-center justify-center gap-1.5 rounded-xl border border-[#e9edf2] bg-white px-2 py-2 text-center text-xs font-semibold text-[#172033] shadow-[0_2px_10px_rgba(23,32,51,0.03)] transition-colors hover:border-emerald-300 dark:border-slate-700 dark:bg-slate-800 dark:text-white">
              <Headphones className="h-5 w-5 text-blue-600 dark:text-blue-400" aria-hidden="true" />
              <span>Support</span>
            </a>
            <button type="button" onClick={() => navigate('/feedback/')} className="flex min-h-[68px] flex-col items-center justify-center gap-1.5 rounded-xl border border-[#e9edf2] bg-white px-2 py-2 text-center text-xs font-semibold text-[#172033] shadow-[0_2px_10px_rgba(23,32,51,0.03)] transition-colors hover:border-emerald-300 dark:border-slate-700 dark:bg-slate-800 dark:text-white">
              <MessageSquare className="h-5 w-5 text-amber-600 dark:text-amber-400" aria-hidden="true" />
              <span>Feedback</span>
            </button>
            <button type="button" onClick={handleShareApp} className="flex min-h-[68px] flex-col items-center justify-center gap-1.5 rounded-xl border border-[#e9edf2] bg-white px-2 py-2 text-center text-xs font-semibold text-[#172033] shadow-[0_2px_10px_rgba(23,32,51,0.03)] transition-colors hover:border-emerald-300 dark:border-slate-700 dark:bg-slate-800 dark:text-white">
              <Share2 className="h-5 w-5 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
              <span>Share App</span>
            </button>
          </div>
          {shareNotice && <p className="mt-2 text-center text-[11px] font-medium text-emerald-600 dark:text-emerald-400" role="status">{shareNotice}</p>}
        </section>

        {installGuide.visible && (
        <section>
          <p className="mb-3 px-1 text-xs font-bold uppercase tracking-[0.05em] text-[#687386] dark:text-slate-400">Get the app</p>
          {/* The guide is a phone screenshot anyone can follow, and opening the
              raw image is the "steps" — no modal, the browser's own image view is
              the viewer. The whole card is one stretched link. */}
          <div className="group relative overflow-hidden rounded-[18px] border border-[#e9edf2] bg-white shadow-[0_2px_10px_rgba(23,32,51,0.03)] transition-colors hover:border-emerald-300 dark:border-slate-700 dark:bg-slate-800">
            <a
              href={installGuide.guideSrc}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Add Gokez Mart to your home screen — view install steps"
              onClick={() => { if (installGuide.platform) trackInstall('install_guide_opened', installGuide.platform); }}
              className="absolute inset-0 z-0 rounded-[18px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
            />
            <div className="pointer-events-none relative z-10 flex items-center gap-4 p-4">
              <div className="min-w-0 flex-1">
                <p className="text-[15px] font-bold leading-snug text-[#172033] dark:text-white">Add Gokez Mart to your home screen</p>
                <p className="mt-1 text-xs text-[#687386] dark:text-slate-400">Install the app for one-tap ordering and live order updates.</p>
                <span className="mt-3 inline-flex items-center gap-1 rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700 transition-colors group-hover:bg-emerald-100 dark:bg-emerald-900/30 dark:text-emerald-300 dark:group-hover:bg-emerald-900/50">
                  <Smartphone className="h-3.5 w-3.5" aria-hidden="true" /> View install steps
                  <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
                </span>
              </div>
              {/* 2:3 portrait frame matches the 1024x1536 guide so object-cover
                  shows it whole instead of cropping it. */}
              <div className="h-36 w-24 flex-shrink-0 overflow-hidden rounded-xl border border-[#e9edf2] bg-[#f7f8fa] dark:border-slate-700 dark:bg-slate-900">
                <img
                  src={installGuide.guideSrc}
                  alt={`How to add Gokez Mart to your home screen${installGuide.platform ? ` on ${installGuide.platform === 'ios' ? 'iPhone' : 'Android'}` : ''}`}
                  loading="lazy"
                  decoding="async"
                  className="h-full w-full object-cover object-top"
                />
              </div>
            </div>
          </div>
        </section>
        )}

        {(storeName || storeAddress || supportPhone || whatsappNumber) && (
          <section>
            <p className="mb-3 px-1 text-xs font-bold uppercase tracking-[0.05em] text-[#687386] dark:text-slate-400">Your local store</p>
            <div className="rounded-[18px] border border-[#e9edf2] bg-white p-4 shadow-[0_2px_10px_rgba(23,32,51,0.03)] dark:border-slate-700 dark:bg-slate-800">
              <div className="flex items-center gap-3">
                <div className="h-11 w-11 flex-shrink-0 overflow-hidden rounded-xl bg-emerald-50 dark:bg-emerald-900/30">
                  <img src="/store_pic.webp" alt={storeName || 'Store'} className="h-full w-full object-cover" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[15px] font-semibold text-[#172033] dark:text-white">{storeName || 'Your delivery store'}</p>
                  {storeAddress && <p className="mt-0.5 text-xs text-[#687386] dark:text-slate-400">({storeAddress})</p>}
                  <p className="mt-0.5 text-[13px] text-[#687386] dark:text-slate-400">
                    {storeName ? 'Your orders are fulfilled by this store.' : 'Order and delivery help'}
                  </p>
                </div>
              </div>
              {(supportPhone || whatsappNumber) && (
                <div className="mt-4 flex gap-2 border-t border-[#e9edf2] pt-3 dark:border-slate-700">
                  {supportPhone && (
                    <a href={`tel:${supportPhone}`}
                      className="flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-xl border border-[#e9edf2] bg-white text-xs font-semibold text-[#172033] shadow-[0_2px_10px_rgba(23,32,51,0.03)] transition-colors hover:border-blue-300 dark:border-slate-700 dark:bg-slate-800 dark:text-white dark:hover:border-blue-500/60">
                      <Phone className="w-4 h-4 text-blue-600 dark:text-blue-400" /> Call store
                    </a>
                  )}
                  {whatsappNumber && (
                    <a href={`https://wa.me/${whatsappNumber.replace(/\D/g, '')}?text=${encodeURIComponent(`Hi, I need help with my order on Gokez Mart.`)}`}
                      target="_blank" rel="noopener noreferrer"
                      className="flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-xl border border-[#e9edf2] bg-white text-xs font-semibold text-[#172033] shadow-[0_2px_10px_rgba(23,32,51,0.03)] transition-colors hover:border-green-300 dark:border-slate-700 dark:bg-slate-800 dark:text-white dark:hover:border-green-500/60">
                      <WhatsAppIcon className="h-4 w-4 text-green-600 dark:text-green-400" /> WhatsApp
                    </a>
                  )}
                </div>
              )}
            </div>
          </section>
        )}

        <section>
        <p className="mb-3 px-1 text-xs font-bold uppercase tracking-[0.05em] text-[#687386] dark:text-slate-400">Preferences</p>
        <div className="overflow-hidden rounded-[18px] border border-[#e9edf2] bg-white shadow-[0_2px_10px_rgba(23,32,51,0.03)] dark:border-slate-700 dark:bg-slate-800 divide-y divide-[#e9edf2] dark:divide-slate-700">
          <div className="flex min-h-[64px] items-center gap-3 px-4">
            {isDark
              ? <Sun className="w-4 h-4 text-amber-500 flex-shrink-0" />
              : <Moon className="w-4 h-4 text-indigo-500 flex-shrink-0" />}
            <div className="flex-1 min-w-0">
              <span className="text-[15px] font-semibold text-[#172033] dark:text-slate-200">Dark mode</span>
              <p className="text-[12px] text-[#687386] dark:text-slate-400">
                {isDark ? 'On — using the dark theme' : 'Off — using the light theme'}
              </p>
            </div>
            <button onClick={toggle} role="switch" aria-checked={isDark} aria-label="Toggle dark mode"
              className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none ${isDark ? 'bg-emerald-500' : 'bg-gray-200 dark:bg-slate-600'}`}>
              <span className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${isDark ? 'translate-x-5' : 'translate-x-0'}`} />
            </button>
          </div>
          <div className="flex min-h-[64px] items-center gap-3 px-4">
            <Navigation className="w-4 h-4 text-blue-500 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <span className="text-[15px] font-semibold text-[#172033] dark:text-slate-200">Location</span>
              <p className="text-[12px] text-[#687386] dark:text-slate-400">
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
                className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none disabled:opacity-70 ${autoDetect ? 'bg-emerald-500' : 'bg-gray-200 dark:bg-slate-600'}`}>
                <span className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${autoDetect ? 'translate-x-5' : 'translate-x-0'}`} />
              </button>
            )}
          </div>
          <div className="flex min-h-[64px] items-center gap-3 px-4">
            <Bell className="w-4 h-4 text-violet-500 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <span className="text-[15px] font-semibold text-[#172033] dark:text-slate-200">Order notifications</span>
              <p className="text-[12px] text-[#687386] dark:text-slate-400">
                {!isLoggedIn ? 'Preference saved on this device' : notificationPermission === 'granted' ? (notificationSubscribed ? 'On - delivery and order alerts' : 'Permission granted - enable alerts') :
                 notificationPermission === 'denied' ? 'Blocked - enable in browser settings' :
                 notificationPermission === 'unsupported' ? 'Not supported on this browser' :
                 'Get delivery and order status alerts'}
              </p>
            </div>
            {!isLoggedIn ? (
              <button onClick={handleOrderNotifications} role="switch" aria-checked={notificationSubscribed} aria-label="Toggle order notifications" className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${notificationSubscribed ? 'bg-emerald-500' : 'bg-gray-200 dark:bg-slate-600'}`}>
                <span className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow transition duration-200 ${notificationSubscribed ? 'translate-x-5' : 'translate-x-0'}`} />
              </button>
            ) : notificationPermission === 'denied' ? (
              <span className="text-[10px] font-semibold text-red-500 bg-red-50 dark:bg-red-900/20 px-2 py-1 rounded-lg">Blocked</span>
            ) : notificationPermission === 'unsupported' ? (
              <span className="text-[10px] font-semibold text-gray-500 bg-gray-100 dark:bg-slate-700 px-2 py-1 rounded-lg">N/A</span>
            ) : (
              <button onClick={handleOrderNotifications} role="switch" aria-checked={notificationSubscribed}
                className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${notificationSubscribed ? 'bg-emerald-500' : 'bg-gray-200 dark:bg-slate-600'}`}>
                <span className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow transition duration-200 ${notificationSubscribed ? 'translate-x-5' : 'translate-x-0'}`} />
              </button>
            )}
          </div>
          <div className="flex min-h-[64px] items-center gap-3 px-4">
            <MessageCircle className="w-4 h-4 text-amber-500 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <span className="text-[15px] font-semibold text-[#172033] dark:text-slate-200">Promotional notifications</span>
              <p className="text-[12px] text-[#687386] dark:text-slate-400">{isLoggedIn ? 'Offers, deals and new arrivals' : 'Preference saved on this device'}</p>
            </div>
            <button onClick={handleMarketingNotifications} role="switch" aria-checked={marketingConsent} aria-label="Toggle promotional notifications"
              className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${marketingConsent ? 'bg-emerald-500' : 'bg-gray-200 dark:bg-slate-600'}`}>
              <span className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow transition duration-200 ${marketingConsent ? 'translate-x-5' : 'translate-x-0'}`} />
            </button>
          </div>
        </div>
        </section>

        <section>
        <p className="mb-3 px-1 text-xs font-bold uppercase tracking-[0.05em] text-[#687386] dark:text-slate-400">Privacy &amp; data</p>
        <div className="overflow-hidden rounded-[18px] border border-[#e9edf2] bg-white shadow-[0_2px_10px_rgba(23,32,51,0.03)] dark:border-slate-700 dark:bg-slate-800">
          <button onClick={() => navigate('/grievance/')} className="flex min-h-[56px] w-full items-center gap-3 px-4 text-left transition-colors hover:bg-gray-50 dark:hover:bg-slate-700/50">
            <MessageCircle className="h-4 w-4 text-gray-500 dark:text-slate-400" />
            <span className="flex-1 text-[15px] font-medium text-[#172033] dark:text-slate-300">Submit a grievance</span>
            <ChevronRight className="h-4 w-4 text-gray-300" />
          </button>
          <button onClick={() => navigate('/privacy/')} className="flex min-h-[56px] w-full items-center gap-3 border-t border-[#e9edf2] px-4 text-left transition-colors hover:bg-gray-50 dark:border-slate-700 dark:hover:bg-slate-700/50">
            <ShieldCheck className="h-4 w-4 text-gray-500 dark:text-slate-400" />
            <span className="flex-1 text-[15px] font-medium text-[#172033] dark:text-slate-300">Privacy policy</span>
            <ChevronRight className="h-4 w-4 text-gray-300" />
          </button>
          <button onClick={() => navigate('/terms/')} className="flex min-h-[56px] w-full items-center gap-3 border-t border-[#e9edf2] px-4 text-left transition-colors hover:bg-gray-50 dark:border-slate-700 dark:hover:bg-slate-700/50">
            <FileText className="h-4 w-4 text-gray-500 dark:text-slate-400" />
            <span className="flex-1 text-[15px] font-medium text-[#172033] dark:text-slate-300">Terms of service</span>
            <ChevronRight className="h-4 w-4 text-gray-300" />
          </button>
        </div>
        </section>

        <section className="pt-1 text-center">
          <p className="mt-6 text-xs text-gray-400 dark:text-slate-500">Version: v0.0.2</p>
          {footer}
        </section>
      </div>
    </div>
  );
}
