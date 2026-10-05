import { BRAND_DESCRIPTION, BRAND_NAME, BRAND_SLOGAN, PARENT_COMPANY, PARENT_COMPANY_URL } from '../constants/brand';

export default function AboutPage() {
  return (
    <main className="page-shell bg-gray-50 dark:bg-slate-900 font-sans">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-10 pb-36">
        <p className="text-sm font-bold uppercase tracking-wide text-emerald-700 dark:text-emerald-400 mb-2">{BRAND_SLOGAN}</p>
        <h1 className="text-3xl font-extrabold text-gray-900 dark:text-white mb-4">About {BRAND_NAME}</h1>
        <div className="space-y-5 text-sm text-gray-600 dark:text-slate-300 leading-relaxed">
          <p>{BRAND_DESCRIPTION}</p>
          <p>
            We bring local stores online — connecting you directly with neighbourhood vendors, no warehouses, no middlemen. Every order supports a real family business and keeps the trust they&apos;ve built in your community over years.
          </p>
          <p>
            {BRAND_NAME} is a product of{' '}
            <a href={PARENT_COMPANY_URL} className="font-semibold text-emerald-700 dark:text-emerald-400 hover:underline">
              {PARENT_COMPANY}
            </a>
            , the company building focused technology products for everyday life in India.
          </p>
          <p>
            Availability depends on the stores and delivery areas currently served by {BRAND_NAME}.
          </p>
        </div>
      </div>
    </main>
  );
}