import { useState, useEffect, useRef } from 'react';

const SLIDES = [
  { src: '/1.webp', alt: 'Gokez Mart — Shop local. Support local.' },
  { src: '/2.webp', alt: 'Fresh from your neighbourhood' },
  { src: '/3.webp', alt: 'Bringing local stores online' },
];

export default function HomeCarousel() {
  const [active, setActive] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const touchStartX = useRef<number | null>(null);

  const startTimer = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => setActive(a => (a + 1) % SLIDES.length), 4000);
  };

  useEffect(() => {
    startTimer();
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, []);

  const goTo = (i: number) => { setActive(i); startTimer(); };

  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (touchStartX.current === null) return;
    const diff = touchStartX.current - e.changedTouches[0].clientX;
    if (Math.abs(diff) > 40) {
      setActive(a => diff > 0 ? (a + 1) % SLIDES.length : (a - 1 + SLIDES.length) % SLIDES.length);
      startTimer();
    }
    touchStartX.current = null;
  };

  return (
    <div className="mt-4 mb-4">
      {/* Image container — 16:9 aspect ratio */}
      <div
        className="relative w-full overflow-hidden rounded-2xl shadow-lg bg-gray-100 dark:bg-slate-800"
        style={{ aspectRatio: '16/9' }}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
      >
        {SLIDES.map((slide, i) => (
          <img
            key={slide.src}
            src={slide.src}
            alt={slide.alt}
            className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-500 ${i === active ? 'opacity-100' : 'opacity-0'}`}
            loading={i === 0 ? 'eager' : 'lazy'}
            decoding="async"
          />
        ))}

        {/* Arrow buttons — desktop */}
        <button
          onClick={() => goTo((active - 1 + SLIDES.length) % SLIDES.length)}
          className="hidden sm:flex absolute left-3 top-1/2 -translate-y-1/2 w-8 h-8 bg-black/40 hover:bg-black/60 text-white rounded-full items-center justify-center transition-colors z-10">
          ‹
        </button>
        <button
          onClick={() => goTo((active + 1) % SLIDES.length)}
          className="hidden sm:flex absolute right-3 top-1/2 -translate-y-1/2 w-8 h-8 bg-black/40 hover:bg-black/60 text-white rounded-full items-center justify-center transition-colors z-10">
          ›
        </button>
      </div>

      {/* Dots */}
      <div className="flex items-center justify-center gap-1.5 mt-2.5">
        {SLIDES.map((_, i) => (
          <button key={i} onClick={() => goTo(i)}
            className={`rounded-full transition-all duration-300 ${
              active === i ? 'w-5 h-1.5 bg-emerald-500' : 'w-1.5 h-1.5 bg-gray-300 dark:bg-slate-600'
            }`} />
        ))}
      </div>
    </div>
  );
}
