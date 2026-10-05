export default function MerchantTermsPage() {
  return (
    <main className="min-h-screen bg-gray-50 dark:bg-slate-900 px-4 py-10 text-sm text-gray-600 dark:text-slate-400">
      <article className="mx-auto max-w-3xl space-y-7 rounded-2xl bg-white p-6 shadow-sm dark:bg-slate-800 sm:p-8">
        <header>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Merchant Platform Agreement</h1>
          <p className="mt-2 text-xs">Version 1.0 | Effective October 2026</p>
        </header>
        <section>
          <h2 className="font-bold text-gray-900 dark:text-white">1. Platform relationship</h2>
          <p className="mt-1">Gokez Technologies Pvt. Ltd. provides Gokez Mart as a subscription-based technology platform. The merchant remains an independent seller and is not an employee, agent or delivery partner of Gokez.</p>
        </section>
        <section>
          <h2 className="font-bold text-gray-900 dark:text-white">2. Selling, payment and delivery</h2>
          <p className="mt-1">The merchant is the seller and fulfiller of its goods. It sets or confirms product prices, applicable taxes, availability, packing, refunds and customer-facing delivery terms. Customer payments are made directly to the merchant using its own cash or UPI arrangement. Gokez does not receive, hold, settle or process those customer funds. Merchant-designated personnel perform delivery and remain the merchant&apos;s responsibility.</p>
        </section>
        <section>
          <h2 className="font-bold text-gray-900 dark:text-white">3. Subscription</h2>
          <p className="mt-1">Access to Gokez Mart is provided under the agreed subscription plan. Subscription fees are separate from customer orders and do not create a commission, payout or settlement arrangement for customer purchases.</p>
        </section>
        <section>
          <h2 className="font-bold text-gray-900 dark:text-white">4. Merchant compliance</h2>
          <p className="mt-1">The merchant must maintain all registrations, licences, permissions, tax treatment, product controls, consumer disclosures and records applicable to its business and products. A declaration or Gokez review is not legal, tax or regulatory advice, and does not replace the merchant&apos;s independent professional advice.</p>
        </section>
        <section>
          <h2 className="font-bold text-gray-900 dark:text-white">5. Customer information</h2>
          <p className="mt-1">The merchant may use customer information made available through the platform only to accept, fulfil, deliver, support or resolve the relevant order, and must protect it from unauthorised use or disclosure. It must not use it for unrelated marketing unless it has a valid lawful basis and any required consent.</p>
        </section>
        <section>
          <h2 className="font-bold text-gray-900 dark:text-white">6. Suspension and updates</h2>
          <p className="mt-1">Gokez may suspend or restrict platform access where declarations appear inaccurate, required information is missing, customer safety is at risk, or the platform is used unlawfully. Gokez may update this agreement; continued platform use after an effective update constitutes acceptance where permitted by law.</p>
        </section>
        <section>
          <h2 className="font-bold text-gray-900 dark:text-white">7. Contact</h2>
          <p className="mt-1">Questions about this agreement: <a className="text-emerald-600 underline" href="mailto:support@gokez.com">support@gokez.com</a>.</p>
        </section>
      </article>
    </main>
  );
}