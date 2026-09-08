import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';

export default function UpdateBanner() {
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null);

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;

    const check = (reg: ServiceWorkerRegistration) => {
      if (reg.waiting) { setWaiting(reg.waiting); return; }
      reg.addEventListener('updatefound', () => {
        const sw = reg.installing;
        if (!sw) return;
        sw.addEventListener('statechange', () => {
          if (sw.state === 'installed' && navigator.serviceWorker.controller) {
            setWaiting(sw);
          }
        });
      });
    };

    navigator.serviceWorker.getRegistration().then(reg => { if (reg) check(reg); });
  }, []);

  if (!waiting) return null;

  const handleUpdate = () => {
    waiting.postMessage({ type: 'SKIP_WAITING' });
    waiting.addEventListener('statechange', () => {
      if (waiting.state === 'activated') window.location.reload();
    });
  };

  return (
    <div className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between gap-3 px-4 py-3 bg-emerald-500 text-white text-sm font-semibold shadow-lg">
      <span>🔄 App updated and ready</span>
      <button onClick={handleUpdate} className="flex items-center gap-1.5 px-3 py-1.5 bg-white text-emerald-600 rounded-xl text-xs font-bold hover:bg-emerald-50 transition-colors">
        <RefreshCw className="w-3.5 h-3.5" /> Refresh
      </button>
    </div>
  );
}
