import { useEffect, useState } from 'react';
import { Share } from 'lucide-react';
import { referralApi, type HomeSection } from '../services/api';
import { useCustomerAuthStore } from '../store/customerAuthStore';
import { buildReferralLink, normalizeReferralCode } from '../utils/referral';

interface Props {
  section: HomeSection;
}

export default function ReferralBanner({ section }: Props) {
  const { isLoggedIn } = useCustomerAuthStore();
  const [code, setCode] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    if (!isLoggedIn) { setCode(''); return; }
    let cancelled = false;
    referralApi.getMe()
      .then((res: any) => {
        if (cancelled) return;
        setCode(normalizeReferralCode(res?.data?.data?.code));
      })
      .catch(() => { if (!cancelled) setCode(''); });
    return () => { cancelled = true; };
  }, [isLoggedIn]);

  const cfg: any = section.config || {};
  const title = section.title || 'Refer & Earn';
  const subtitle = section.subtitle || '';
  const image = cfg.imageUrl || cfg.image_url || null;
  const buttonLabel = cfg.buttonText || cfg.cta || 'Share';

  const shareLink = buildReferralLink(code, window.location.origin);

  const handleShare = async () => {
    if (!shareLink) return;
    try {
      const nav = navigator as any;
      if (nav.share) {
        await nav.share({ title: 'Gokez Mart', text: subtitle || 'Join Gokez Mart and earn rewards.', url: shareLink });
        return;
      }
      await navigator.clipboard.writeText(shareLink);
      setNotice('Link copied');
      window.setTimeout(() => setNotice(''), 2500);
    } catch {
      try {
        await navigator.clipboard.writeText(shareLink);
        setNotice('Link copied');
        window.setTimeout(() => setNotice(''), 2500);
      } catch {}
    }
  };

  const rule = section.visibilityRule || 'always';
  if (rule === 'logged_in' && !isLoggedIn) return null;
  if (rule === 'guests' && isLoggedIn) return null;

  if (!code && !isLoggedIn) return null;

  return (
    <section className="w-full">
      <div
        className="relative w-full overflow-hidden rounded-2xl"
        style={{ aspectRatio: '16 / 5' }}
      >
        {image ? (
          <img src={image} alt={section.title || 'Refer and earn'} className="absolute inset-0 h-full w-full object-cover" />
        ) : (
          <div className="absolute inset-0 bg-gradient-to-r from-gokez-700 to-gokez-500" />
        )}
        <div className="absolute inset-0 flex flex-col justify-center gap-1 px-4 sm:px-6">
          <p className="text-sm font-bold text-white sm:text-base">{title}</p>
          {subtitle && <p className="text-xs text-white/90 sm:text-sm">{subtitle}</p>}
          {code && (
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <span className="rounded-lg bg-white/20 px-2 py-1 font-mono text-xs font-bold text-white backdrop-blur-sm">
                {code}
              </span>
              <button
                type="button"
                onClick={handleShare}
                className="inline-flex items-center gap-1 rounded-lg bg-white px-3 py-1.5 text-xs font-bold text-gokez-800 transition-colors hover:bg-cream-50"
              >
                <Share className="h-3.5 w-3.5" aria-hidden="true" />
                {buttonLabel}
              </button>
            </div>
          )}
          {notice && <p className="mt-1 text-[11px] font-medium text-white/90">{notice}</p>}
        </div>
      </div>
    </section>
  );
}
