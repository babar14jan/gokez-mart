export default function PrivacyPage() {
  const updated = 'September 2026';
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-slate-900 font-sans">
      <div className="sticky top-0 z-10 bg-white dark:bg-slate-900 border-b border-gray-100 dark:border-slate-800 px-4 py-3 flex items-center gap-3">
        <button onClick={() => window.history.back()}
          className="p-1.5 rounded-xl hover:bg-gray-100 dark:hover:bg-slate-800 transition-colors">
          <svg className="w-5 h-5 text-gray-600 dark:text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
        </button>
        <h1 className="text-sm font-bold text-gray-900 dark:text-white">Privacy Policy</h1>
      </div>
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6 pb-24">
        <p className="text-xs text-gray-400 dark:text-slate-500 mb-8">Last updated: {updated}</p>

        <div className="space-y-8 text-sm text-gray-600 dark:text-slate-400 leading-relaxed">

          <section>
            <h2 className="text-base font-bold text-gray-900 dark:text-white mb-2">1. Who We Are</h2>
            <p>GokezMart is operated by <strong className="text-gray-800 dark:text-slate-200">Gokez Technologies Pvt. Ltd.</strong>, a company registered in India. We provide a hyperlocal grocery delivery service in Kolkata. This policy explains how we collect, use, and protect your personal data when you use our app or website.</p>
          </section>

          <section>
            <h2 className="text-base font-bold text-gray-900 dark:text-white mb-2">2. Data We Collect</h2>
            <ul className="list-disc list-inside space-y-1.5">
              <li><strong className="text-gray-700 dark:text-slate-300">Mobile number</strong> — used for OTP login and order communication</li>
              <li><strong className="text-gray-700 dark:text-slate-300">Name & address</strong> — used for delivery</li>
              <li><strong className="text-gray-700 dark:text-slate-300">Location (GPS)</strong> — used only to detect your delivery zone. Never stored or tracked continuously</li>
              <li><strong className="text-gray-700 dark:text-slate-300">Order history</strong> — items ordered, payment method, delivery address</li>
              <li><strong className="text-gray-700 dark:text-slate-300">Device info</strong> — browser type, for push notification delivery</li>
            </ul>
          </section>

          <section>
            <h2 className="text-base font-bold text-gray-900 dark:text-white mb-2">3. How We Use Your Data</h2>
            <ul className="list-disc list-inside space-y-1.5">
              <li>Process and deliver your orders</li>
              <li>Send order status notifications (push / WhatsApp)</li>
              <li>Detect your nearest delivery zone</li>
              <li>Improve our service and product catalogue</li>
              <li>Comply with legal obligations</li>
            </ul>
          </section>

          <section>
            <h2 className="text-base font-bold text-gray-900 dark:text-white mb-2">4. Location Data</h2>
            <p>We request location permission to automatically detect which delivery zone you are in (e.g. Shapoorji or Gobra). We do <strong className="text-gray-700 dark:text-slate-300">not</strong> store your GPS coordinates. Location is used only at the moment of zone detection and during checkout. You can disable location access at any time from your Account → Settings.</p>
          </section>

          <section>
            <h2 className="text-base font-bold text-gray-900 dark:text-white mb-2">5. Data Sharing</h2>
            <p>We do <strong className="text-gray-700 dark:text-slate-300">not</strong> sell your personal data. We share data only with:</p>
            <ul className="list-disc list-inside space-y-1.5 mt-2">
              <li>Our delivery staff — name, phone, address for order fulfilment</li>
              <li>Payment processors — only what is required to process your payment</li>
              <li>Cloud infrastructure (Supabase, Render, Cloudflare) — for app hosting</li>
            </ul>
          </section>

          <section>
            <h2 className="text-base font-bold text-gray-900 dark:text-white mb-2">6. Data Retention</h2>
            <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-slate-700">
              <table className="w-full text-xs">
                <thead className="bg-gray-100 dark:bg-slate-700">
                  <tr>
                    <th className="px-4 py-2.5 text-left font-semibold text-gray-700 dark:text-slate-300">Data</th>
                    <th className="px-4 py-2.5 text-left font-semibold text-gray-700 dark:text-slate-300">Retention</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-slate-700">
                  {[
                    ['Order history', '2 years'],
                    ['Account data', 'Until deletion request'],
                    ['OTP records', '10 minutes (auto-deleted)'],
                    ['Payment records', '7 years (tax law)'],
                    ['Inactive accounts', '2 years from last activity'],
                  ].map(([d, r]) => (
                    <tr key={d}>
                      <td className="px-4 py-2.5 text-gray-700 dark:text-slate-300">{d}</td>
                      <td className="px-4 py-2.5 text-emerald-700 dark:text-emerald-400 font-semibold">{r}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section>
            <h2 className="text-base font-bold text-gray-900 dark:text-white mb-2">7. Your Rights</h2>
            <p>Under the Digital Personal Data Protection Act, 2023 (DPDP Act), you have the right to:</p>
            <ul className="list-disc list-inside space-y-1.5 mt-2">
              <li>Access your personal data</li>
              <li>Correct inaccurate data</li>
              <li>Request deletion of your account and data</li>
              <li>Withdraw consent for data processing</li>
            </ul>
            <p className="mt-2">To exercise these rights, contact us at <a href="mailto:support@gokez.com" className="text-emerald-600 dark:text-emerald-400 hover:underline">support@gokez.com</a>.</p>
          </section>

          <section>
            <h2 className="text-base font-bold text-gray-900 dark:text-white mb-2">8. Push Notifications</h2>
            <p>We send push notifications for order status updates (e.g. "Your order is out for delivery"). You can enable or disable notifications at any time from Account → Settings. We never send promotional notifications without your consent.</p>
          </section>

          <section>
            <h2 className="text-base font-bold text-gray-900 dark:text-white mb-2">9. Security</h2>
            <p>All data is encrypted in transit (HTTPS/TLS). OTPs expire in 10 minutes. JWT tokens expire in 30 days. We use Supabase (SOC 2 compliant) for database storage.</p>
          </section>

          <section>
            <h2 className="text-base font-bold text-gray-900 dark:text-white mb-2">10. Grievance Officer</h2>
            <div className="bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-100 dark:border-emerald-800 rounded-xl p-4">
              <p className="font-semibold text-gray-800 dark:text-white mb-2">Gokez Technologies Pvt. Ltd.</p>
              <p className="text-gray-600 dark:text-slate-400">Email: <a href="mailto:support@gokez.com" className="text-emerald-600 dark:text-emerald-400 hover:underline">support@gokez.com</a></p>
              <p className="text-gray-600 dark:text-slate-400">Kolkata, West Bengal, India</p>
              <p className="text-xs text-gray-400 dark:text-slate-500 mt-2">We acknowledge grievances within 24 hours and resolve within 30 days as required under DPDP Act, 2023.</p>
            </div>
          </section>

        </div>
      </div>
    </div>
  );
}
