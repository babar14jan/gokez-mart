import { useState, useEffect, useRef, useCallback } from 'react';
import { campaignApi } from '../services/api';
import { useCustomerAuthStore } from '../store/customerAuthStore';
import SmartImage from './SmartImage';

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
}

// Fallback static slides if API fails
const FALLBACK: Slide[] = [
  { id: '1', title: 'Shop local. Support local.', subtitle: 'Fresh from your neighbourhood', image_url: '/1.webp', gradient: 'from-emerald-500 via-teal-500 to-cyan-500', campaign_id: null, campaignTitle: null, campaignBadge: null, discountType: null, discountValue: null, couponCode: null },
  { id: '2', title: 'Farm fresh every day', subtitle: 'Sourced directly from local vendors', image_url: '/2.webp', gradient: 'from-violet-500 via-purple-600 to-indigo-600', campaign_id: null, campaignTitle: null, campaignBadge: null, discountType: null, discountValue: null, couponCode: null },
  { id: '3', title: 'Bringing local stores online', subtitle: 'Your neighbourhood store, now at your door', image_url: '/3.webp', gradient: 'from-rose-500 via-pink-500 to-fuchsia-500', campaign_id: null, campaignTitle: null, campaignBadge: null, discountType: null, discountValue: null, couponCode: null },
];

function discountLabel(slide: Slide): string {
  if (!slide.discountType) return '';
  const val = slide.discountValue ? Math.round(slide.discountValue) : 0;
  if (slide.discountType === 'flat') return `₹${val} OFF`;
  if (slide.discountType === 'percent') return `${val}% OFF`;
  if (slide.discountType === 'free_delivery') return 'FREE DELIVERY';
  return '';
}

export default function HomeCarousel() {
  const { isLoggedIn } = useCustomerAuthStore();
  const [slides, setSlides] = useState<Slide[]>(FALLBACK);
  const [active, setActive] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const settleRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLDivElement | null)[]>([]);
  const displayIndexRef = useRef(1);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const n = slides.length;
  const loop = n > 1;
  // A clone of the last slide is prepended and a clone of the first is appended
  // so the strip can keep scrolling forward forever. Landing on either clone is
  // silently snapped back onto the matching real slide — identical pixels, so
  // the wrap is invisible and it reads as a continuous cycle.
  const offset = loop ? 1 : 0;
  const displaySlides: Slide[] = loop ? [slides[n - 1], ...slides, slides[0]] : slides;

  useEffect(() => {
    campaignApi.getCarousel()
      .then(r => {
        const data = r.data.data || [];
        if (data.length > 0) {
          setSlides(data);
          setActive(0);
        }
      })
      .catch(() => {}); // fallback to static
  }, [isLoggedIn]);

  const stopTimer = useCallback(() => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
  }, []);

  // Content offset that centres a display slot in the viewport.
  const centerOf = useCallback((di: number): number | null => {
    const track = trackRef.current;
    const el = itemRefs.current[di];
    if (!track || !el) return null;
    return el.offsetLeft - (track.clientWidth - el.offsetWidth) / 2;
  }, []);

  const scrollToDisplay = useCallback((di: number, behavior: ScrollBehavior = 'smooth') => {
    const track = trackRef.current;
    const left = centerOf(di);
    if (track && left != null) track.scrollTo({ left, behavior });
  }, [centerOf]);

  // When a clone settles in the centre, hop to the real slide without animating.
  const normalize = useCallback((d: number) => {
    if (!loop) return;
    if (d === 0) { scrollToDisplay(n, 'auto'); displayIndexRef.current = n; }
    else if (d === n + 1) { scrollToDisplay(1, 'auto'); displayIndexRef.current = 1; }
  }, [loop, n, scrollToDisplay]);

  // Scroll-driven scale/opacity for the peek effect, plus loop bookkeeping.
  const handleScroll = useCallback(() => {
    const track = trackRef.current;
    if (!track) return;
    const center = track.scrollLeft + track.clientWidth / 2;
    let best = offset;
    let bestDist = Infinity;
    itemRefs.current.forEach((el, di) => {
      if (!el) return;
      const dist = Math.abs(el.offsetLeft + el.offsetWidth / 2 - center);
      const norm = Math.max(0, 1 - dist / (el.offsetWidth * 0.8));
      el.style.transform = `scale(${0.9 + 0.1 * norm})`;
      el.style.opacity = `${0.55 + 0.45 * norm}`;
      if (dist < bestDist) { bestDist = dist; best = di; }
    });
    displayIndexRef.current = best;
    const real = ((best - offset) % n + n) % n;
    setActive(prev => (prev === real ? prev : real));

    // Wait until the scroll settles before hopping off a clone, so momentum and
    // snap have finished and the swap is invisible.
    if (settleRef.current) clearTimeout(settleRef.current);
    settleRef.current = setTimeout(() => normalize(displayIndexRef.current), 90);
  }, [n, offset, normalize]);

  const startTimer = useCallback(() => {
    stopTimer();
    if (!loop) return;
    timerRef.current = setInterval(() => {
      scrollToDisplay(displayIndexRef.current + 1);
    }, 4000);
  }, [loop, stopTimer, scrollToDisplay]);

  useEffect(() => {
    startTimer();
    return () => { stopTimer(); if (settleRef.current) clearTimeout(settleRef.current); };
  }, [startTimer, stopTimer]);

  // Park the strip on the first real slide whenever the slide set changes.
  useEffect(() => {
    const id = requestAnimationFrame(() => {
      scrollToDisplay(offset, 'auto');
      handleScroll();
    });
    return () => cancelAnimationFrame(id);
  }, [slides, offset, scrollToDisplay, handleScroll]);

  const goTo = (i: number) => { setActive(i); scrollToDisplay(i + offset); startTimer(); };

  const copyCode = (code: string, id: string) => {
    navigator.clipboard.writeText(code);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  if (slides.length === 0) return null;

  return (
    <div className="mt-1 mb-2">
      {/* Mobile: centered peek carousel (snap + scale), looping */}
      <div className="sm:hidden">
        <div
          ref={trackRef}
          onScroll={handleScroll}
          onPointerDown={stopTimer}
          onPointerUp={startTimer}
          onPointerCancel={startTimer}
          className="flex gap-3 overflow-x-auto scrollbar-hide snap-x snap-mandatory py-1"
          style={{ paddingLeft: '5%', paddingRight: '5%', WebkitOverflowScrolling: 'touch' }}
        >
          {displaySlides.map((s, di) => {
            const isCamp = !!s.campaign_id;
            return (
              <div
                key={`${s.id}-${di}`}
                ref={el => { itemRefs.current[di] = el; }}
                className="relative flex-shrink-0 snap-center overflow-hidden rounded-2xl shadow-lg"
                style={{ width: '90%', aspectRatio: '16/9', transform: 'scale(0.9)', opacity: 0.55 }}
              >
                {/* Background — image or gradient */}
                <SmartImage
                  fill
                  src={s.image_url}
                  alt={s.title || ''}
                  imgClassName="object-cover"
                  loading="eager"
                  decoding="async"
                  fallback={
                    <div className={`absolute inset-0 bg-gradient-to-br ${s.gradient}`}>
                      <div className="absolute -right-8 -top-8 w-48 h-48 rounded-full bg-white/10 pointer-events-none" />
                      <div className="absolute right-6 -bottom-10 w-32 h-32 rounded-full bg-white/10 pointer-events-none" />
                    </div>
                  }
                />

                {/* Uploaded artwork remains unobstructed. */}
                {isCamp && !s.image_url && <div className="absolute inset-0 bg-black/20" />}

                {/* Campaign content — used when no custom artwork is supplied */}
                {isCamp && !s.image_url && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-6 z-10">
                    {s.campaignBadge && (
                      <span className="inline-block text-[11px] font-bold bg-white/25 text-white px-3 py-1 rounded-full mb-3 backdrop-blur-sm border border-white/30">
                        {s.campaignBadge}
                      </span>
                    )}
                    {discountLabel(s) && (
                      <p className="text-4xl font-black text-white drop-shadow-lg leading-none mb-2">
                        {discountLabel(s)}
                      </p>
                    )}
                    {s.title && (
                      <p className="text-sm font-bold text-white/90 mb-1">{s.title}</p>
                    )}
                    {s.subtitle && (
                      <p className="text-xs text-white/70 mb-3">{s.subtitle}</p>
                    )}
                    {s.couponCode ? (
                      <button
                        onClick={() => copyCode(s.couponCode!, s.id)}
                        className="flex items-center gap-2 bg-white/20 backdrop-blur-sm text-white text-xs font-bold px-4 py-2 rounded-xl border border-white/30 hover:bg-white/30 transition-colors">
                        <span className="font-mono tracking-wider">{s.couponCode}</span>
                        <span className="text-[10px] opacity-80">{copiedId === s.id ? '✓ Copied!' : 'Tap to copy'}</span>
                      </button>
                    ) : s.campaign_id && (
                      <span className="text-[11px] text-white/80 bg-white/15 px-3 py-1 rounded-full border border-white/20">
                        ✨ Auto-applied at checkout
                      </span>
                    )}
                  </div>
                )}

                {/* Title overlay — only for gradient slides with no image */}
                {!isCamp && s.title && !s.image_url && (
                  <div className="absolute bottom-0 left-0 right-0 p-3 bg-gradient-to-t from-black/40 to-transparent z-10">
                    <p className="text-xs font-bold text-white drop-shadow">{s.title}</p>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Dots — mobile only */}
        {loop && (
          <div className="flex items-center justify-center gap-1.5 mt-2.5">
            {slides.map((_, i) => (
              <button key={i} onClick={() => goTo(i)} aria-label={`Go to slide ${i + 1}`}
                className={`rounded-full transition-all duration-300 ${active === i ? 'w-5 h-1.5 bg-emerald-500' : 'w-1.5 h-1.5 bg-gray-300 dark:bg-slate-600'}`} />
            ))}
          </div>
        )}
      </div>{/* end mobile-only */}

      {/* Desktop: horizontal scroll strip of smaller cards */}
      <div className="hidden sm:block">
        <div className="flex gap-3 overflow-x-auto pb-2 scrollbar-hide">
          {slides.map((s, i) => {
            const isCamp = !!s.campaign_id;
            return (
              <div
                key={s.id}
                onClick={() => goTo(i)}
                className={`relative flex-shrink-0 overflow-hidden rounded-2xl shadow-md cursor-pointer transition-all ${
                  active === i ? 'ring-2 ring-emerald-500 scale-[1.02]' : 'opacity-80 hover:opacity-100'
                }`}
                style={{ width: 'calc(33.333% - 8px)', aspectRatio: '16/9' }}
              >
                {/* Background */}
                <SmartImage
                  src={s.image_url}
                  alt={s.title || ''}
                  className="h-full w-full"
                  imgClassName="object-cover"
                  fallback={
                    <div className={`w-full h-full bg-gradient-to-br ${s.gradient}`}>
                      <div className="absolute -right-4 -top-4 w-24 h-24 rounded-full bg-white/10" />
                    </div>
                  }
                />
                {/* Custom campaign artwork is shown without text or dimming. */}
                {isCamp && !s.image_url && <div className="absolute inset-0 bg-black/20" />}
                {isCamp && !s.image_url && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-3 z-10">
                    {s.campaignBadge && (
                      <span className="text-[9px] font-bold bg-white/25 text-white px-2 py-0.5 rounded-full mb-1.5 border border-white/30">{s.campaignBadge}</span>
                    )}
                    {discountLabel(s) && (
                      <p className="text-2xl font-black text-white drop-shadow leading-none mb-1">{discountLabel(s)}</p>
                    )}
                    {s.title && <p className="text-xs font-bold text-white/90">{s.title}</p>}
                    {!s.couponCode && s.campaign_id && (
                      <span className="text-[9px] text-white/70 mt-1">✨ Auto-applied</span>
                    )}
                    {s.couponCode && (
                      <span className="text-[9px] font-mono font-bold text-white bg-white/20 px-2 py-0.5 rounded-lg mt-1">{s.couponCode}</span>
                    )}
                  </div>
                )}
                {/* Active indicator */}
                {active === i && (
                  <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-emerald-500" />
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
