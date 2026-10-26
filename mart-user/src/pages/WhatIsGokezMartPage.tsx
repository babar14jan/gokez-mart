import { BRAND_DESCRIPTION, BRAND_PROMISE, BRAND_NAME, BRAND_SLOGAN, PARENT_COMPANY, PARENT_COMPANY_URL } from '../constants/brand';
import PageHeader from '../components/PageHeader';

// Public, indexable explainer page. Unlike the tab views this is a real
// document: direct links, the prerendered SEO copy and the sitemap all point
// here, and its canonical lives in src/utils/seo.ts with the other public
// routes. It exists so a search for the brand has a page whose content
// unambiguously answers "what is this?", rather than only the app shell.
export default function WhatIsGokezMartPage() {
  return (
    <main className="page-shell bg-gray-50 dark:bg-slate-900 font-sans">
      <PageHeader title={`What is ${BRAND_NAME}?`} />
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-10">
        <p className="text-sm font-bold uppercase tracking-wide text-gokez-800 dark:text-gokez-400 mb-2">{BRAND_SLOGAN}</p>
        <h1 className="text-3xl font-extrabold text-gray-900 dark:text-white mb-4">What is {BRAND_NAME}?</h1>
        <div className="space-y-5 text-sm text-gray-600 dark:text-slate-300 leading-relaxed">
          <p>{BRAND_DESCRIPTION}</p>
          <p>{BRAND_PROMISE}</p>

          <h2 className="text-lg font-bold text-gray-900 dark:text-white pt-2">How it works</h2>
          <ol className="list-decimal space-y-2 pl-5">
            <li>Choose your delivery area to see the stores that serve it.</li>
            <li>Browse everyday essentials and add what you need to your cart.</li>
            <li>Check out and pay online or on delivery, and track your order to the door.</li>
          </ol>

          <h2 className="text-lg font-bold text-gray-900 dark:text-white pt-2">What you can order</h2>
          <p>
            Fresh produce, groceries, household and personal-care items, and other daily essentials from local
            stores. What is available depends on the stores and delivery areas currently served.
          </p>

          <h2 className="text-lg font-bold text-gray-900 dark:text-white pt-2">Who runs {BRAND_NAME}</h2>
          <p>
            {BRAND_NAME} is a product of{' '}
            <a href={PARENT_COMPANY_URL} className="font-semibold text-gokez-800 dark:text-gokez-400 hover:underline">
              {PARENT_COMPANY}
            </a>
            , the company building focused technology products for everyday life in India.
          </p>

          <p>
            Learn more <a href="/about/" className="font-semibold text-gokez-800 dark:text-gokez-400 hover:underline">about {BRAND_NAME}</a>,
            or <a href="/" className="font-semibold text-gokez-800 dark:text-gokez-400 hover:underline">start shopping</a>.
          </p>
        </div>
      </div>
    </main>
  );
}
