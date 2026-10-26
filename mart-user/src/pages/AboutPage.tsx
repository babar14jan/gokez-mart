import { BRAND_DESCRIPTION, BRAND_PROMISE, BRAND_NAME, BRAND_SLOGAN, PARENT_COMPANY, PARENT_COMPANY_URL } from '../constants/brand';
import PageHeader from '../components/PageHeader';

export default function AboutPage() {
  return (
    <main className="page-shell bg-cream-50 dark:bg-slate-900 font-sans">
      <PageHeader title="About Gokez Mart" />
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-10">
        <div className="bg-white dark:bg-slate-800 rounded-2xl border border-cream-200 p-6 shadow-card dark:border-slate-700 text-center">
          <img src="/mart_brand_new.webp" alt="Gokez Mart" className="h-16 w-auto object-contain mx-auto" />
          <p className="-mt-1 text-sm font-semibold text-gokez-700 dark:text-gokez-400">{BRAND_SLOGAN}</p>
          <p className="mt-4 text-sm text-gray-900 dark:text-white leading-relaxed">{BRAND_DESCRIPTION}</p>
          <p className="mt-3 text-sm text-gray-500 dark:text-slate-400 leading-relaxed">{BRAND_PROMISE}</p>
        </div>

        <div className="mt-6 space-y-5 text-sm text-gray-600 dark:text-slate-300 leading-relaxed">
          <p>
            {BRAND_NAME} is a product of{' '}
            <a href={PARENT_COMPANY_URL} className="font-semibold text-gokez-700 dark:text-gokez-400 hover:underline">
              {PARENT_COMPANY}
            </a>
            , the company building focused technology products for everyday life in India.
          </p>
          <p>
            Availability depends on the stores and delivery areas currently served by {BRAND_NAME}.
          </p>
        </div>

        <div className="mt-6 grid grid-cols-4 items-center gap-1.5">
          {['/f1.webp', '/f2.webp', '/f3.webp', '/f4.webp'].map((src) => (
            <img key={src} src={src} alt="" className="w-full" />
          ))}
        </div>
      </div>
    </main>
  );
}