import { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Phone, MessageCircle, Bell, Navigation, ShieldCheck, FileText, ChevronRight, Headphones, MessageSquare, Share2, Moon, Sun, Smartphone, ArrowUpRight, X, Sparkles, Info } from 'lucide-react';
import { authApi, suggestionApi } from '../services/api';
import { useCustomerAuthStore } from '../store/customerAuthStore';
import { useThemeStore } from '../store/themeStore';
import { useZoneStore } from '../store/zoneStore';
import { getLocationPermission, getNotificationPermission, requestNotificationPermission, subscribeToPush, unsubscribeFromPush, hasActivePushSubscription, isPushSupported } from '../services/push';
import { useAccountLoginStore } from '../store/accountLoginStore';
import { useLoginFlowStore } from '../store/loginFlowStore';
import LoginFlow, { type Step } from '../components/LoginFlow';
import PageHeader from '../components/PageHeader';
import { track, trackInstall } from '../utils/track';
import { useInstallGuide, dismissInstallGuide } from '../utils/install';
import { BRAND_SLOGAN } from '../constants/brand';
import { GOKEZ_SUPPORT } from '../constants/gokezSupport';
import { buildWhatsAppLink } from '../utils/whatsapp';

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
  const [notificationPermission, setNotificationPermission] = useState(
    isPushSupported() ? getNotificationPermission() : 'unsupported',
  );
  const [notificationSubscribed, setNotificationSubscribed] = useState(false);
  const [notificationsBusy, setNotificationsBusy] = useState(false);
  const [notificationNotice, setNotificationNotice] = useState('');
  const [marketingConsent, setMarketingConsent] = useState(false);
  const [shareNotice, setShareNotice] = useState('');
  // Offered on phones until the app is actually installed to the home screen.
  const installGuide = useInstallGuide();
  // The install guide opens in an in-app viewer (not a raw browser tab) so the
  // page can offer an explicit "Done" button under the image.
  const [installGuideOpen, setInstallGuideOpen] = useState(false);
  // Hides the card for the cooling period the moment it is dismissed, without
  // waiting for a remount to re-read the stored timestamp.
  const [installCardHidden, setInstallCardHidden] = useState(false);

  // Count the guide as "shown" once per session, the moment the card becomes
  // visible. There is no native Android accept/decline prompt in this app: the
  // guide card is the prompt, so its appearance is what the hub's funnel reads
  // as "Prompt Shown".
  const installShownRef = useRef(false);
  useEffect(() => {
    if (!installGuide.visible || installCardHidden || installShownRef.current) return;
    installShownRef.current = true;
    trackInstall('install_prompt_shown', installGuide.platform ?? 'android');
  }, [installGuide.visible, installCardHidden, installGuide.platform]);

  // Closing the viewer without installing is a "dismissed" guide.
  const closeInstallGuide = useCallback(() => {
    if (installGuide.platform) trackInstall('install_guide_dismissed', installGuide.platform);
    setInstallGuideOpen(false);
  }, [installGuide.platform]);

  // Declining the card starts the cooling period so it stops reappearing on
  // every visit. Treated as a decline in the install funnel.
  const declineInstallCard = useCallback(() => {
    dismissInstallGuide();
    setInstallCardHidden(true);
    if (installGuide.platform) trackInstall('install_prompt_declined', installGuide.platform);
  }, [installGuide.platform]);

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

  useEffect(() => {
    getLocationPermission().then(setLocationPermission);
  }, []);

  // Install-guide viewer: Escape to dismiss and lock the page behind it while it
  // is up (same behaviour the shared dialogs use).
  useEffect(() => {
    if (!installGuideOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closeInstallGuide(); };
    document.addEventListener('keydown', onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
    };
  }, [installGuideOpen, closeInstallGuide]);

  // Suggestion sheet: same Escape + scroll-lock contract as the install viewer.
  useEffect(() => {
    if (!suggestOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closeSuggest(); };
    document.addEventListener('keydown', onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
    };
  }, [suggestOpen]);

  useEffect(() => {
    const refreshNotificationPermission = () => setNotificationPermission(
      isPushSupported() ? getNotificationPermission() : 'unsupported',
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
    if (!isLoggedIn) {
      try {
        setMarketingConsent(localStorage.getItem(GUEST_MARKETING_CONSENT_KEY) === 'true');
      } catch {
        setMarketingConsent(false);
      }
      // Guests now use the same real push subscription as members, so derive the
      // toggle from the browser's actual subscription rather than a localStorage
      // flag (which could show "On" with nothing registered, or vice versa).
      hasActivePushSubscription().then(setNotificationSubscribed).catch(() => setNotificationSubscribed(false));
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
    // Tapping the toggle is the "direct enable" path: request permission (or
    // skip the prompt if already granted) and subscribe this device. Guests and
    // members both register for real; subscribeToPush picks the right endpoint.
    // Every step is guarded so a hung worker or a dismissed prompt can never
    // leave the switch stuck half-way (which previously needed a second tap).
    if (notificationsBusy) return;
    setNotificationsBusy(true);
    setNotificationNotice('');

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

  const handleShareApp = async () => {
    // Count the intent to share regardless of whether the OS share sheet is then
    // completed or cancelled. The funnel event carries device/platform, so the
    // hub can slice share clicks by phone type.
    track('share_app_clicked');
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
    // The guest escape is keyboard-only now, but it still has to report the
    // abandonment or the hub funnel would miss it on this page.
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
    // The phone step gets the tall green hero. The OTP step is plain white with a
    // slim app bar and back chevron (page chrome that nudges the flow back via
    // loginBackSignal). Profile/offer stay plain pale green.
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
          <div className="text-center">
            <div className="relative flex flex-col items-center overflow-hidden bg-[linear-gradient(180deg,#4ade80_0%,#86efac_16%,#d1fae5_42%,#ecfdf5_68%,#fef9c3_100%)] px-6 pb-4 pt-[41px] dark:bg-slate-900 dark:bg-none">
              <img
                src="/mart_brand_new.webp"
                alt="Gokez Mart"
                width={384}
                height={256}
                className="-mb-3 h-[62px] w-auto object-contain"
              />
              <p className="mt-0 text-[clamp(9px,calc(4vw-6px),29px)] font-bold leading-tight text-slate-900 dark:text-white">{BRAND_SLOGAN}</p>
              <p
                className="mt-4 bg-gradient-to-r from-emerald-600 via-amber-500 to-rose-500 bg-clip-text text-center font-black leading-none tracking-tight text-transparent text-[clamp(12px,3.75vw,28px)]"
              >
                From your neighbourhood store to your door
              </p>
            </div>
            <h1 className="mt-3 text-[15px] font-black leading-tight text-gray-600 dark:text-gray-300">Log in or sign up</h1>
          </div>
        )}
        <div className={`relative w-full overflow-hidden ${
          showBrandHeader
            ? 'bg-white sm:mx-auto sm:max-w-sm sm:rounded-3xl sm:shadow-xl dark:bg-slate-800'
            : showOtpHeader
              ? 'flex-1 sm:mx-auto sm:max-w-sm'
              : 'sm:mx-auto sm:max-w-sm'
        }`}>
          <div className={showBrandHeader ? "px-5 pb-6 pt-1 space-y-4" : showOtpHeader ? "px-5 pb-6 pt-[44px] space-y-4" : "px-5 pb-6 pt-2 space-y-4"}>
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
    );
  }

  return (
    <div className="page-shell bg-[#f7f8fa] dark:bg-slate-900 font-sans">
      <div className="mx-auto max-w-2xl space-y-7 px-4 py-5 pb-10 sm:px-6 sm:py-7">
        {!isLoggedIn && (
        <div className="relative -mx-4 -mt-5 overflow-hidden rounded-none border-y border-cream-200 bg-white p-4 shadow-[0_2px_10px_rgba(23,32,51,0.04)] dark:border-slate-700 dark:bg-slate-800 sm:-mx-6 sm:-mt-7">
          <div className="min-w-0">
              <p className="text-sm font-semibold text-center text-gray-500 dark:text-slate-400">Log in or sign up to access your complete account.</p>
              <button type="button" onClick={openLogin} className="mt-3 flex min-h-11 w-full items-center justify-center rounded-md bg-black px-3 text-sm font-semibold text-white transition-colors hover:bg-gray-900 dark:bg-gokez-700 dark:hover:bg-gokez-800">Continue login</button>
          </div>
        </div>
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
            <button type="button" onClick={handleShareApp} className="flex min-h-[68px] flex-col items-center justify-center gap-1.5 rounded-xl border border-cream-200 bg-white px-2 py-2 text-center text-xs font-semibold text-ink shadow-[0_2px_10px_rgba(23,32,51,0.03)] transition-colors hover:border-gokez-300 dark:border-slate-700 dark:bg-slate-800 dark:text-white">
              <Share2 className="h-5 w-5 text-gokez-700 dark:text-gokez-400" aria-hidden="true" />
              <span>Share App</span>
            </button>
          </div>
          {shareNotice && <p className="mt-2 text-center text-[11px] font-medium text-gokez-700 dark:text-gokez-400" role="status">{shareNotice}</p>}
        </section>

        {installGuide.visible && !installCardHidden && (
        <section>
          <p className="mb-3 px-1 text-xs font-bold uppercase tracking-[0.05em] text-gray-500 dark:text-slate-400">Get the app</p>
          {/* The guide is a phone screenshot anyone can follow. It opens in an
              in-app viewer rather than the browser's raw image view (a new tab
              the app cannot add a "Done" button to), so the whole card is one
              stretched button. */}
          <div className="group relative overflow-hidden rounded-[18px] border border-cream-200 bg-white shadow-[0_2px_10px_rgba(23,32,51,0.03)] transition-colors hover:border-gokez-300 dark:border-slate-700 dark:bg-slate-800">
            <button
              type="button"
              onClick={() => {
                if (installGuide.platform) trackInstall('install_guide_opened', installGuide.platform);
                setInstallGuideOpen(true);
              }}
              aria-label="Add Gokez Mart to your home screen — view install steps"
              className="absolute inset-0 z-0 rounded-[18px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gokez-500"
            />
            {/* Dismiss starts the cooling period. Sits above the stretched card
                button so its tap is not swallowed by the "view steps" action. */}
            <button
              type="button"
              onClick={declineInstallCard}
              aria-label="Dismiss install suggestion"
              className="absolute right-2 top-2 z-20 rounded-full p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:text-slate-500 dark:hover:bg-slate-700 dark:hover:text-slate-300"
            >
              <X className="h-4 w-4" />
            </button>
            <div className="pointer-events-none relative z-10 flex items-center gap-3 p-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-bold leading-snug text-ink dark:text-white">Add Gokez Mart to your home screen</p>
                <p className="mt-0.5 text-[11px] leading-snug text-gray-500 dark:text-slate-400">Install for one-tap ordering and live order updates.</p>
                <span className="mt-3 inline-flex items-center gap-1 rounded-lg border border-gokez-200 bg-gokez-50 px-3 py-1.5 text-[11px] font-semibold text-gokez-700 shadow-sm transition-colors group-hover:bg-gokez-100 dark:border-gokez-900/50 dark:bg-gokez-900/30 dark:text-gokez-300 dark:group-hover:bg-gokez-900/50">
                  <Smartphone className="h-3 w-3" aria-hidden="true" /> View install steps
                  <ArrowUpRight className="h-3 w-3" aria-hidden="true" />
                </span>
              </div>
              {/* 2:3 portrait frame matches the 1024x1536 guide so object-cover
                  shows it whole instead of cropping it. Sized to roughly match
                  the text column so the card height follows the copy, not the
                  image. */}
              <div className="h-28 w-[74px] flex-shrink-0 overflow-hidden rounded-lg border border-cream-200 bg-cream-50 dark:border-slate-700 dark:bg-slate-900">
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

        <section>
          <button
            type="button"
            onClick={() => setSuggestOpen(true)}
            className="flex w-full items-center gap-4 rounded-[18px] border border-cream-200 bg-white p-4 text-left shadow-[0_2px_10px_rgba(23,32,51,0.03)] transition-colors hover:border-gokez-300 dark:border-slate-700 dark:bg-slate-800 dark:hover:border-gokez-500/60"
          >
            <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl bg-gokez-50 dark:bg-gokez-900/30">
              <Sparkles className="h-5 w-5 text-gokez-700 dark:text-gokez-400" aria-hidden="true" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[15px] font-bold leading-snug text-ink dark:text-white">Suggest a product</p>
              <p className="mt-1 text-xs text-gray-500 dark:text-slate-400">Tell us what you would like us to stock.</p>
            </div>
            <ChevronRight className="h-4 w-4 flex-shrink-0 text-gray-500 dark:text-slate-400" aria-hidden="true" />
          </button>
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
          <p className="mt-6 text-xs text-gray-400 dark:text-slate-500">Version: V.0.1.2</p>
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

      {/* Install-guide viewer. The guide is a tall phone screenshot, so it scrolls
          inside a full-screen sheet with a pinned "Done" bar — the browser's own
          image view (a new tab) has nowhere to put that button. Portalled so it
          escapes the page scroll container and covers the whole viewport. */}
      {installGuideOpen && createPortal(
        <div className="sheet-enter fixed inset-0 z-[90] flex flex-col bg-slate-900/95 backdrop-blur-sm">
          <div className="flex-1 overflow-y-auto overscroll-contain px-4 pt-[max(2.5rem,env(safe-area-inset-top))]">
            {/* Plain, honest copy. The point is to remove any "is this a scam?"
                doubt: it is the same Gokez Mart site as a home-screen shortcut,
                nothing is downloaded, and it can be removed anytime. */}
            <div className="mx-auto mb-4 max-w-md rounded-2xl bg-white/95 px-4 py-3 dark:bg-slate-800/95">
              <p className="text-sm font-bold text-gray-900 dark:text-white">Add a Gokez Mart shortcut</p>
              <p className="mt-1 text-xs leading-relaxed text-gray-600 dark:text-slate-300">
                This puts a Gokez Mart icon on your home screen so you can open and order in one tap. It is the same site you are using now — nothing is downloaded, and no extra permission is asked.
              </p>
              <p className="mt-1 text-xs leading-relaxed text-gray-600 dark:text-slate-300">
                You can remove it anytime, just like any other app icon.
              </p>
            </div>
            <img
              src={installGuide.guideSrc}
              alt={`How to add Gokez Mart to your home screen${installGuide.platform ? ` on ${installGuide.platform === 'ios' ? 'iPhone' : 'Android'}` : ''}`}
              className="mx-auto h-auto w-full max-w-md rounded-2xl"
            />
          </div>
          <div className="px-4 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))]">
            <button
              type="button"
              onClick={() => closeInstallGuide()}
              className="w-full rounded-xl bg-gokez-700 px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-gokez-800"
            >
              Got it
            </button>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
