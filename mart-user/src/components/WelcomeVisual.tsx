import type { RefObject } from 'react';

export type WelcomeImageStatus = 'loading' | 'loaded' | 'failed';

interface WelcomeVisualProps {
  status: WelcomeImageStatus;
  imageRef: RefObject<HTMLImageElement>;
  onImageLoad: () => void;
  onImageError: () => void;
}

export default function WelcomeVisual({ status, imageRef, onImageLoad, onImageError }: WelcomeVisualProps) {
  if (status === 'failed') {
    return (
      <div className="welcome-fallback absolute inset-0 flex flex-col items-center justify-center overflow-hidden bg-white text-center" role="status">
        <div className="mx-auto w-full max-w-[22rem]">
          <div className="mx-auto h-1.5 w-12 rounded-full bg-[#F4C400]" aria-hidden="true" />
          <h1 className="welcome-fallback-heading mx-auto mt-4 max-w-[20rem] text-[22px] font-extrabold leading-tight tracking-tight text-[#087A43] sm:text-[24px]">
            Welcome to Gokez Mart
          </h1>
          <p className="welcome-fallback-subtitle mt-2 text-[15px] font-semibold leading-snug text-[#087A43] sm:text-[16px]">
            Bringing Your Neighbourhood Shops Online.
          </p>
          <p className="welcome-fallback-quote mx-auto mt-5 max-w-[20rem] border-t-2 border-[#F4C400] pt-4 text-[13px] font-medium leading-relaxed text-slate-700 sm:text-[14px]">
            <span className="font-black text-[#F4C400]">“</span>We’re on a mission to help local shops grow and thrive in an era of big warehouses and dark stores.<span className="font-black text-[#F4C400]">”</span>
          </p>
        </div>
      </div>
    );
  }

  return (
    <img
      ref={imageRef}
      src="/get_started.webp"
      alt=""
      aria-hidden="true"
      className="welcome-art absolute inset-0 h-full w-full select-none object-cover object-center"
      draggable={false}
      onLoad={onImageLoad}
      onError={onImageError}
    />
  );
}
