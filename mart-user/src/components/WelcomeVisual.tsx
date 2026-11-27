import { useState } from 'react';

export default function WelcomeVisual() {
  const [logoFailed, setLogoFailed] = useState(false);
  const [artFailed, setArtFailed] = useState(false);

  return (
    <section aria-labelledby="welcome-heading" className="login-brand-bg relative flex h-full flex-col overflow-hidden">
      <div className="onboarding-scroll relative h-full w-full overflow-y-auto px-4 sm:px-6">
        <div className="mx-auto flex min-h-full w-full max-w-sm flex-col">
          <img
            src="/logo_and_brand_white_g.webp"
            alt="Gokez Mart — Shop Local. Support Local."
            className={`login-brand-unit block h-auto max-w-full select-none object-contain${logoFailed ? ' hidden' : ''}`}
            draggable={false}
            onError={() => setLogoFailed(true)}
          />
          {logoFailed && <span className="login-brand-fallback font-extrabold leading-tight tracking-tight text-[#087A43] dark:text-[#F4C400]" role="img" aria-label="Gokez Mart — Shop Local. Support Local.">Gokez Mart</span>}

          <div className="flex flex-1 flex-col items-center justify-center pb-4 text-center">
            <img
              src="/welcome_image.webp"
              alt=""
              aria-hidden="true"
              className={`welcome-image block h-auto shrink-0 select-none object-contain${artFailed ? ' hidden' : ''}`}
              draggable={false}
              onError={() => setArtFailed(true)}
            />

            <div className="mx-auto mt-3 w-full max-w-[22rem]">
              <div className="mx-auto h-1.5 w-12 rounded-full bg-[#F4C400]" aria-hidden="true" />
              <h1 id="welcome-heading" className="welcome-fallback-heading mx-auto mt-4 max-w-[20rem] text-[22px] font-extrabold leading-tight tracking-tight text-[#087A43] sm:text-[24px]">
                Welcome to Gokez Mart
              </h1>
              <p className="welcome-fallback-subtitle mt-2 text-[15px] font-semibold leading-snug text-[#087A43] sm:text-[16px]">
                Bringing Your Neighbourhood Shops Online.
              </p>
              <p className="welcome-fallback-quote mx-auto mt-5 max-w-[22rem] border-t-2 border-[#F4C400] pt-4 text-[16px] font-bold leading-relaxed text-[#5A4100] sm:text-[18px]">
                <span className="font-black text-[#F4C400]">“</span>We’re on a mission to help local shops grow and thrive in an era of big warehouses and dark stores.<span className="font-black text-[#F4C400]">”</span>
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
