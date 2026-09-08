import { useEffect, useState } from 'react';
import { X, Share, Plus } from 'lucide-react';

type Platform = 'android' | 'ios' | null;

function detectPlatform(): Platform {
  const ua = navigator.userAgent.toLowerCase();
  const isIOS = /iphone|ipad|ipod/.test(ua);
  const isAndroid = /android/.test(ua);
  const isStandalone = (window.navigator as any).standalone === true
    || window.matchMedia('(display-mode: standalone)').matches;
  if (isStandalone) return null; // already installed
  if (isIOS) return 'ios';
  if (isAndroid) return 'android';
  return null;
}

const DISMISSED_KEY = 'mart_install_dismissed';
const INSTALLED_KEY = 'mart_install_done';
const DISMISSED_DAYS = 30;

function wasDismissedRecently(): boolean {
  if (localStorage.getItem(INSTALLED_KEY)) return true;
  const ts = localStorage.getItem(DISMISSED_KEY);
  if (!ts) return false;
  return Date.now() - parseInt(ts) < DISMISSED_DAYS * 86400000;
}

export default function InstallPrompt() {
  const [platform, setPlatform] = useState<Platform>(null);
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [show, setShow] = useState(false);
  const [showIOSGuide, setShowIOSGuide] = useState(false);

  useEffect(() => {
    if (wasDismissedRecently()) return;
    const p = detectPlatform();
    setPlatform(p);

    if (p === 'android') {
      const handler = (e: Event) => {
        e.preventDefault();
        setDeferredPrompt(e);
        // Show after 30s — don't interrupt immediately
        setTimeout(() => setShow(true), 30000);
      };
      window.addEventListener('beforeinstallprompt', handler);
      return () => window.removeEventListener('beforeinstallprompt', handler);
    }

    if (p === 'ios') {
      // Show iOS banner after 30s
      setTimeout(() => setShow(true), 30000);
    }
  }, []);

  const dismiss = () => {
    setShow(false);
    setShowIOSGuide(false);
    localStorage.setItem(DISMISSED_KEY, String(Date.now()));
  };

  const handleAndroidInstall = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') {
      localStorage.setItem(INSTALLED_KEY, '1');
      dismiss();
    }
    setDeferredPrompt(null);
  };

  if (!show) return null;

  // ── Android banner ────────────────────────────────────────────────────────
  if (platform === 'android') {
    return (
      <div className="fixed bottom-24 left-3 right-3 z-50 animate-fade-in">
        <div className="bg-slate-900 text-white rounded-2xl shadow-2xl p-4 flex items-center gap-3">
          <img src="/icons/icon-96.png" alt="Gokez Mart" className="w-12 h-12 rounded-xl flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold leading-tight">Install Gokez Mart</p>
            <p className="text-xs text-slate-400 mt-0.5">Add to home screen for faster access & order notifications</p>
          </div>
          <div className="flex flex-col gap-1.5 flex-shrink-0">
            <button onClick={handleAndroidInstall}
              className="px-3 py-1.5 bg-emerald-500 hover:bg-emerald-600 text-white text-xs font-bold rounded-xl transition-colors">
              Install
            </button>
            <button onClick={dismiss}
              className="px-3 py-1.5 text-slate-400 text-xs font-medium text-center hover:text-white transition-colors">
              Not now
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── iOS banner + guide ────────────────────────────────────────────────────
  if (platform === 'ios') {
    if (showIOSGuide) {
      return (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/60 backdrop-blur-sm">
          <div className="bg-white dark:bg-slate-800 w-full rounded-t-3xl shadow-2xl p-6 pb-8">
            <div className="flex items-center justify-between mb-5">
              <div className="flex items-center gap-3">
                <img src="/icons/icon-96.png" alt="Gokez Mart" className="w-10 h-10 rounded-xl" />
                <div>
                  <p className="text-sm font-bold text-gray-900 dark:text-white">Add to Home Screen</p>
                  <p className="text-xs text-gray-400 dark:text-slate-500">3 quick steps</p>
                </div>
              </div>
              <button onClick={dismiss} className="p-1.5 rounded-xl text-gray-400 hover:bg-gray-100 dark:hover:bg-slate-700">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-4">
              {/* Step 1 */}
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 bg-blue-500 rounded-full flex items-center justify-center flex-shrink-0">
                  <span className="text-white text-xs font-bold">1</span>
                </div>
                <div className="flex-1">
                  <p className="text-sm font-semibold text-gray-900 dark:text-white">Tap the Share button</p>
                  <p className="text-xs text-gray-400 dark:text-slate-500 mt-0.5">At the bottom of Safari, tap the Share icon</p>
                  <div className="mt-2 inline-flex items-center gap-1.5 bg-gray-100 dark:bg-slate-700 px-3 py-1.5 rounded-xl">
                    <Share className="w-4 h-4 text-blue-500" />
                    <span className="text-xs font-medium text-gray-700 dark:text-slate-300">Share</span>
                  </div>
                </div>
              </div>

              {/* Step 2 */}
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 bg-blue-500 rounded-full flex items-center justify-center flex-shrink-0">
                  <span className="text-white text-xs font-bold">2</span>
                </div>
                <div className="flex-1">
                  <p className="text-sm font-semibold text-gray-900 dark:text-white">Scroll down and tap</p>
                  <p className="text-xs text-gray-400 dark:text-slate-500 mt-0.5">Find and tap "Add to Home Screen"</p>
                  <div className="mt-2 inline-flex items-center gap-1.5 bg-gray-100 dark:bg-slate-700 px-3 py-1.5 rounded-xl">
                    <Plus className="w-4 h-4 text-gray-600 dark:text-slate-300" />
                    <span className="text-xs font-medium text-gray-700 dark:text-slate-300">Add to Home Screen</span>
                  </div>
                </div>
              </div>

              {/* Step 3 */}
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 bg-emerald-500 rounded-full flex items-center justify-center flex-shrink-0">
                  <span className="text-white text-xs font-bold">3</span>
                </div>
                <div className="flex-1">
                  <p className="text-sm font-semibold text-gray-900 dark:text-white">Tap Add</p>
                  <p className="text-xs text-gray-400 dark:text-slate-500 mt-0.5">Confirm by tapping "Add" in the top right</p>
                </div>
              </div>
            </div>

            <p className="text-[10px] text-gray-400 dark:text-slate-500 text-center mt-5">
              Once added, you'll get order notifications even when the app is closed
            </p>
          </div>
        </div>
      );
    }

    return (
      <div className="fixed bottom-24 left-3 right-3 z-50 animate-fade-in">
        <div className="bg-slate-900 text-white rounded-2xl shadow-2xl p-4 flex items-center gap-3">
          <img src="/icons/icon-96.png" alt="Gokez Mart" className="w-12 h-12 rounded-xl flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold leading-tight">Add to Home Screen</p>
            <p className="text-xs text-slate-400 mt-0.5">Get order notifications on your iPhone</p>
          </div>
          <div className="flex flex-col gap-1.5 flex-shrink-0">
            <button onClick={() => { localStorage.setItem(INSTALLED_KEY, '1'); setShowIOSGuide(true); }}
              className="px-3 py-1.5 bg-emerald-500 hover:bg-emerald-600 text-white text-xs font-bold rounded-xl transition-colors">
              How to
            </button>
            <button onClick={dismiss}
              className="px-3 py-1.5 text-slate-400 text-xs font-medium text-center hover:text-white transition-colors">
              Not now
            </button>
          </div>
        </div>
      </div>
    );
  }

  return null;
}
