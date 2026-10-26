import { useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react';
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

interface CarouselSettings {
  autoplay_enabled: boolean;
  autoplay_interval_seconds: number;
}

function discountLabel(slide: Slide): string {
  if (!slide.discountType) return '';
  const val = slide.discountValue ? Math.round(slide.discountValue) : 0;
  if (slide.discountType === 'flat') return `₹${val} OFF`;
  if (slide.discountType === 'percent') return `${val}% OFF`;
  if (slide.discountType === 'free_delivery') return 'FREE DELIVERY';
  return '';
}

// The whole Home view (and therefore this carousel) is conditionally rendered in
// App, so every tab switch unmounts and remounts it. These module-level values
// survive the remount: without them each return to Home refetched the slides and
// re-rendered at scrollLeft 0 (the prepended last-slide clone), which the browser
// then snapped to the first slide only after paint — the "fast move / shake /
// flicker" shoppers saw. Caching the last slides + active index lets a remount
// paint the exact same frame instantly.
let cachedSlides: Slide[] | null = null;
let cachedActive = 0;
let cachedSettings: CarouselSettings = { autoplay_enabled: true, autoplay_interval_seconds: 4 };

export default function HomeCarousel() {
  const { isLoggedIn } = useCustomerAuthStore();
  const [slides, setSlides] = useState<Slide[]>(() => cachedSlides ?? []);
  const [active, setActive] = useState(() => {
    const len = (cachedSlides ?? []).length;
    return Math.min(Math.max(cachedActive, 0), Math.max(0, len - 1));
  });
  const [settings, setSettings] = useState<CarouselSettings>(cachedSettings);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const settleRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLDivElement | null)[]>([]);
  const slidesRef = useRef(slides);
  slidesRef.current = slides;
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const n = slides.length;
  const loop = n > 1;
  // A clone of the last slide is prepended and a clone of the first is appended
  // so the strip can keep scrolling forward forever. Landing on either clone is
  // silently snapped back onto the matching real slide — identical pixels, so
  // the wrap is invisible and it reads as a continuous cycle.
  const offset = loop ? 1 : 0;
  const displaySlides: Slide[] = loop ? [slides[n - 1], ...slides, slides[0]] : slides;
  // First paint targets the cached slide (clamped to the set) so a remount lands
  // on the exact same frame with no post-paint jump.
  const displayIndexRef = useRef(
    Math.min((loop ? 1 : 0) + Math.max(cachedActive, 0), loop ? n + 1 : Math.max(0, n - 1)),
  );

  useEffect(() => {
    campaignApi.getCarousel()
      .then(slidesResponse => {
        const data: Slide[] = slidesResponse.data.data || [];
        cachedSlides = data;
        const prev = slidesRef.current;
        // Identical set (the common remount case): keep the current slide and DOM
        // as-is so nothing moves. Positioning is handled by the layout effect.
        if (prev.length === data.length && prev.every((s, i) => s.id === data[i].id)) return;
        setSlides(data);
      })
      .catch(() => {});
    campaignApi.getCarouselSettings()
      .then(settingsResponse => {
        const savedSettings: CarouselSettings = settingsResponse.data.data || cachedSettings;
        cachedSettings = savedSettings;
        setSettings(savedSettings);
      })
      .catch(() => {});
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
    if (!track || n === 0) return;
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
    cachedActive = real;
    setActive(prev => (prev === real ? prev : real));

    // Wait until the scroll settles before hopping off a clone, so momentum and
    // snap have finished and the swap is invisible.
    if (settleRef.current) clearTimeout(settleRef.current);
    settleRef.current = setTimeout(() => normalize(displayIndexRef.current), 90);
  }, [n, offset, normalize]);

  const startTimer = useCallback(() => {
    stopTimer();
    if (!loop || !settings.autoplay_enabled) return;
    timerRef.current = setInterval(() => {
      scrollToDisplay(displayIndexRef.current + 1);
    }, settings.autoplay_interval_seconds * 1000);
  }, [loop, settings, stopTimer, scrollToDisplay]);

  useEffect(() => {
    startTimer();
    return () => { stopTimer(); if (settleRef.current) clearTimeout(settleRef.current); };
  }, [startTimer, stopTimer]);

  // Position the strip BEFORE the browser paints so the very first frame is
  // already the correct slide — no post-paint jump. On a remount it restores the
  // cached slide; if the slide set changed and that index no longer exists it
  // falls back to the first slide.
  const slidesKey = slides.map(s => s.id).join('|');
  useLayoutEffect(() => {
    const track = trackRef.current;
    if (!track || track.clientWidth === 0 || n === 0) return;
    let real = Math.max(cachedActive, 0);
    if (real >= n) real = 0;
    cachedActive = real;
    displayIndexRef.current = Math.min((loop ? 1 : 0) + real, loop ? n + 1 : Math.max(0, n - 1));
    scrollToDisplay(displayIndexRef.current, 'auto');
    handleScroll();
    // Keyed on the slide set only: repositions when the set actually changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slidesKey]);

  const goTo = (i: number) => { cachedActive = i; setActive(i); scrollToDisplay(i + offset); startTimer(); };

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
                className="relative flex-shrink-0 snap-center overflow-hidden rounded-2xl shadow-card"
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
                className={`rounded-full transition-all duration-300 ${active === i ? 'h-1.5 w-5 bg-gokez-700 dark:bg-gokez-400' : 'h-1.5 w-1.5 bg-cream-300 dark:bg-slate-600'}`} />
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
                className={`relative flex-shrink-0 overflow-hidden rounded-2xl shadow-card cursor-pointer transition-all ${
                  active === i ? 'ring-2 ring-gokez-500 ring-offset-2 ring-offset-cream-50 dark:ring-offset-slate-900' : 'opacity-80 hover:opacity-100'
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
                  <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-gokez-700" />
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
