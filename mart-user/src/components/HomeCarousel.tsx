import { useState, useEffect, useRef } from 'react';
import { campaignApi } from '../services/api';

interface Slide {
  id: string;
  title: string | null;
  subtitle: string | null;
  image_url: string | null;
  gradient: string;
  campaign_id: string | null;
  campaignTitle: string | null;
  campaignBadge: string | null;
  discountType: string | null;
  discountValue: number | null;
  couponCode: string | null;
  validUntil: string | null;
}

// Fallback static slides if API fails
const FALLBACK: Slide[] = [
  { id: '1', title: 'Shop local. Support local.', subtitle: 'Fresh from your neighbourhood', image_url: '/1.webp', gradient: 'from-emerald-500 via-teal-500 to-cyan-500', campaign_id: null, campaignTitle: null, campaignBadge: null, discountType: null, discountValue: null, couponCode: null, validUntil: null },
  { id: '2', title: 'Farm fresh every day', subtitle: 'Sourced directly from local vendors', image_url: '/2.webp', gradient: 'from-violet-500 via-purple-600 to-indigo-600', campaign_id: null, campaignTitle: null, campaignBadge: null, discountType: null, discountValue: null, couponCode: null, validUntil: null },
  { id: '3', title: 'Bringing local stores online', subtitle: 'Your neighbourhood store, now at your door', image_url: '/3.webp', gradient: 'from-rose-500 via-pink-500 to-fuchsia-500', campaign_id: null, campaignTitle: null, campaignBadge: null, discountType: null, discountValue: null, couponCode: null, validUntil: null },
];

function discountLabel(slide: Slide): string {
  if (!slide.discountType) return '';
  if (slide.discountType === 'flat') return `₹${slide.discountValue} OFF`;
  if (slide.discountType === 'percent') return `${slide.discountValue}% OFF`;
  if (slide.discountType === 'free_delivery') return 'FREE DELIVERY';
  return '';
}

export default function HomeCarousel() {
  const [slides, setSlides] = useState<Slide[]>(FALLBACK);
  const [active, setActive] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const touchStartX = useRef<number | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    campaignApi.getCarousel()
      .then(r => {
        const data = r.data.data || [];
        if (data.length > 0) setSlides(data);
      })
      .catch(() => {}); // fallback to static
  }, []);

  const startTimer = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => setActive(a => (a + 1) % slides.length), 4000);
  };

  useEffect(() => {
    startTimer();
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [slides.length]);

  const goTo = (i: number) => { setActive(i); startTimer(); };

  const handleTouchStart = (e: React.TouchEvent) => { touchStartX.current = e.touches[0].clientX; };
  const handleTouchEnd = (e: React.TouchEvent) => {
    if (touchStartX.current === null) return;
    const diff = touchStartX.current - e.changedTouches[0].clientX;
    if (Math.abs(diff) > 40) { setActive(a => diff > 0 ? (a + 1) % slides.length : (a - 1 + slides.length) % slides.length); startTimer(); }
    touchStartX.current = null;
  };

  const copyCode = (code: string) => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const slide = slides[active];
  if (!slide) return null;

  const isCampaignSlide = !!slide.campaign_id;

  return (
    <div className="mt-4 mb-4">
      <div
        className="relative w-full overflow-hidden rounded-2xl shadow-lg"
        style={{ aspectRatio: '16/9' }}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
      >
        {/* Background — image or gradient */}
        {slide.image_url ? (
          <img
            src={slide.image_url}
            alt={slide.title || ''}
            className="absolute inset-0 w-full h-full object-cover transition-opacity duration-500"
            loading="eager"
            decoding="async"
          />
        ) : (
          <div className={`absolute inset-0 bg-gradient-to-br ${slide.gradient}`}>
            <div className="absolute -right-8 -top-8 w-48 h-48 rounded-full bg-white/10 pointer-events-none" />
            <div className="absolute right-6 -bottom-10 w-32 h-32 rounded-full bg-white/10 pointer-events-none" />
          </div>
        )}

        {/* Campaign overlay — shown on campaign slides */}
        {isCampaignSlide && (
          <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/20 to-transparent" />
        )}

        {/* Campaign content */}
        {isCampaignSlide && (
          <div className="absolute bottom-0 left-0 right-0 p-4 z-10">
            {slide.campaignBadge && (
              <span className="inline-block text-[10px] font-bold bg-white/20 text-white px-2 py-0.5 rounded-full mb-1.5 backdrop-blur-sm">
                {slide.campaignBadge}
              </span>
            )}
            {discountLabel(slide) && (
              <p className="text-2xl font-black text-white drop-shadow leading-tight">{discountLabel(slide)}</p>
            )}
            {slide.title && <p className="text-sm font-bold text-white/90 mt-0.5">{slide.title}</p>}
            {slide.couponCode && (
              <button
                onClick={() => copyCode(slide.couponCode!)}
                className="mt-2 flex items-center gap-2 bg-white/20 backdrop-blur-sm text-white text-xs font-bold px-3 py-1.5 rounded-xl border border-white/30 hover:bg-white/30 transition-colors">
                <span className="font-mono">{slide.couponCode}</span>
                <span className="text-[10px] opacity-80">{copied ? '✓ Copied!' : 'Tap to copy'}</span>
              </button>
            )}
            {!slide.couponCode && slide.campaign_id && (
              <p className="text-[10px] text-white/70 mt-1">Auto-applied at checkout</p>
            )}
          </div>
        )}

        {/* Title overlay — only for gradient slides with no image */}
        {!isCampaignSlide && slide.title && !slide.image_url && (
          <div className="absolute bottom-0 left-0 right-0 p-3 bg-gradient-to-t from-black/40 to-transparent z-10">
            <p className="text-xs font-bold text-white drop-shadow">{slide.title}</p>
          </div>
        )}

        {/* Arrow buttons — desktop */}
        <button onClick={() => goTo((active - 1 + slides.length) % slides.length)}
          className="hidden sm:flex absolute left-3 top-1/2 -translate-y-1/2 w-8 h-8 bg-black/40 hover:bg-black/60 text-white rounded-full items-center justify-center transition-colors z-10 text-lg">
          ‹
        </button>
        <button onClick={() => goTo((active + 1) % slides.length)}
          className="hidden sm:flex absolute right-3 top-1/2 -translate-y-1/2 w-8 h-8 bg-black/40 hover:bg-black/60 text-white rounded-full items-center justify-center transition-colors z-10 text-lg">
          ›
        </button>
      </div>

      {/* Dots */}
      <div className="flex items-center justify-center gap-1.5 mt-2.5">
        {slides.map((_, i) => (
          <button key={i} onClick={() => goTo(i)}
            className={`rounded-full transition-all duration-300 ${active === i ? 'w-5 h-1.5 bg-emerald-500' : 'w-1.5 h-1.5 bg-gray-300 dark:bg-slate-600'}`} />
        ))}
      </div>
    </div>
  );
}
