import { useState, useEffect, useRef } from 'react';

const CARDS = [
  {
    icon: '⚡',
    title: 'Delivering in 10-15 mins',
    sub: 'From our store to your door. Fresh. Fast. Every time.',
    gradient: 'from-emerald-500 via-teal-500 to-cyan-500',
    dot: 'bg-emerald-400',
    textColor: 'text-white',
    subColor: 'text-white/90',
  },
  {
    icon: '🤝',
    title: 'Sourced from Neighbours',
    sub: 'While big apps fly in from warehouses, we support your local vendors.',
    gradient: 'from-rose-500 via-pink-500 to-fuchsia-500',
    dot: 'bg-rose-400',
    textColor: 'text-white',
    subColor: 'text-white/90',
  },
  {
    icon: '🛵',
    title: 'Free Delivery',
    sub: 'On orders above ₹150. No hidden charges. Delivery is on us.',
    gradient: 'from-violet-500 via-purple-500 to-indigo-500',
    dot: 'bg-violet-400',
    textColor: 'text-white',
    subColor: 'text-white/90',
  },
];

export default function HomeCarousel() {
  const [active, setActive] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const touchStartX = useRef<number | null>(null);

  const startTimer = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => setActive(a => (a + 1) % CARDS.length), 4000);
  };

  useEffect(() => { startTimer(); return () => { if (timerRef.current) clearInterval(timerRef.current); }; }, []);

  const handleDotClick = (i: number) => { setActive(i); startTimer(); };

  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (touchStartX.current === null) return;
    const diff = touchStartX.current - e.changedTouches[0].clientX;
    if (Math.abs(diff) > 40) {
      setActive(a => diff > 0 ? (a + 1) % CARDS.length : (a - 1 + CARDS.length) % CARDS.length);
      startTimer();
    }
    touchStartX.current = null;
  };

  const card = CARDS[active];

  return (
    <div className="mt-4 mb-4">
      {/* Fixed height card */}
      <div className={`relative bg-gradient-to-br ${card.gradient} rounded-2xl overflow-hidden shadow-lg h-28 sm:h-32`}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}>
        <div className="absolute inset-0 p-4 sm:p-5 flex flex-col justify-center">

          {/* Decorative circles */}
          <div className="absolute -right-8 -top-8 w-40 h-40 rounded-full bg-white/10 pointer-events-none" />
          <div className="absolute right-4 -bottom-10 w-28 h-28 rounded-full bg-white/10 pointer-events-none" />

          {/* Content */}
          <div className="relative z-10 flex items-start gap-3">
            <span className="text-3xl leading-none mt-0.5 flex-shrink-0">{card.icon}</span>
            <div>
              <h3 className={`${card.textColor} font-extrabold text-lg sm:text-xl leading-tight tracking-tight drop-shadow-md`}>
                {card.title}
              </h3>
              <p className={`${card.subColor} text-sm mt-1 leading-snug font-medium drop-shadow-sm`}>
                {card.sub}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Dots */}
      <div className="flex items-center justify-center gap-1.5 mt-2.5">
        {CARDS.map((c, i) => (
          <button key={i} onClick={() => handleDotClick(i)}
            className={`rounded-full transition-all duration-300 ${
              active === i ? `w-5 h-1.5 ${c.dot}` : 'w-1.5 h-1.5 bg-gray-300 dark:bg-slate-600'
            }`} />
        ))}
      </div>
    </div>
  );
}
