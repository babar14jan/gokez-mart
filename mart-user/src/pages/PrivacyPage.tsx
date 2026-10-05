export default function PrivacyPage({ embed = false }: { embed?: boolean } = {}) {
  const updated = 'October 2026';
  return (
    <div className="page-shell bg-gray-50 dark:bg-slate-900 font-sans">
      {!embed && (
        <div className="sticky top-0 z-10 bg-white dark:bg-slate-900 border-b border-gray-100 dark:border-slate-800 px-4 py-3 flex items-center gap-3">
          <button onClick={() => window.history.back()}
            className="p-1.5 rounded-xl hover:bg-gray-100 dark:hover:bg-slate-800 transition-colors">
            <svg className="w-5 h-5 text-gray-600 dark:text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
          </button>
          <h1 className="text-sm font-bold text-gray-900 dark:text-white">Privacy Policy</h1>
        </div>
      )}
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6 pb-36">
        <p className="text-xs text-gray-500 dark:text-slate-400 mb-8">Last updated: {updated}</p>

        <div className="space-y-8 text-sm text-gray-600 dark:text-slate-400 leading-relaxed">

          <section>
            <h2 className="text-base font-bold text-gray-900 dark:text-white mb-2">1. Who We Are</h2>
            <p>Gokez Mart is operated by <strong className="text-gray-800 dark:text-slate-200">Gokez Technologies Pvt. Ltd.</strong>. We provide marketplace technology that connects customers with independent local stores. This policy explains how we collect, use and disclose personal data when you use our app or website.</p>
          </section>

          <section>
            <h2 className="text-base font-bold text-gray-900 dark:text-white mb-2">2. Data We Collect</h2>
            <ul className="list-disc list-inside space-y-1.5">
              <li><strong className="text-gray-700 dark:text-slate-300">Mobile number</strong> — used for OTP login and order communication</li>
              <li><strong className="text-gray-700 dark:text-slate-300">Name & address</strong> — used for delivery</li>
              <li><strong className="text-gray-700 dark:text-slate-300">Location and address</strong> — address and, when supplied, location coordinates used for zone checks, saved addresses and order delivery</li>
              <li><strong className="text-gray-700 dark:text-slate-300">Order data</strong> — selected merchant, items, delivery preference, contact details, address, order status and stated payment method</li>
              <li><strong className="text-gray-700 dark:text-slate-300">Device and usage data</strong> — browser/device information, notification subscription data, cookies or local storage, cart and attribution information</li>
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
            <p>Location permission is optional. If you grant it, we use your approximate or precise device location to check delivery-zone availability and may save coordinates submitted with an address or order to support delivery. We do not use the app for continuous background location tracking. You can decline permission or remove it in your device or browser settings.</p>
          </section>

          <section>
            <h2 className="text-base font-bold text-gray-900 dark:text-white mb-2">5. Data Sharing</h2>
            <p>We do <strong className="text-gray-700 dark:text-slate-300">not</strong> sell your personal data. We share data only with:</p>
            <ul className="list-disc list-inside space-y-1.5 mt-2">
              <li>The selected merchant and its authorised store or delivery personnel — the information necessary to accept, fulfil and deliver your order</li>
              <li>Service providers that host, secure, support or send communications for the platform, under applicable contractual or legal safeguards</li>
              <li>Authorities or others where required by law or necessary to protect users, merchants or the platform</li>
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
            <p>We use reasonable technical and organisational measures designed to protect personal data, including transport encryption where supported. No internet service can guarantee absolute security. Please keep OTPs and account access credentials confidential.</p>
          </section>

          <section>
            <h2 className="text-base font-bold text-gray-900 dark:text-white mb-2">10. Grievance Officer</h2>
            <div className="bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-100 dark:border-emerald-800 rounded-xl p-4">
              <p className="font-semibold text-gray-800 dark:text-white mb-2">Gokez Technologies Pvt. Ltd.</p>
              <p className="text-gray-600 dark:text-slate-400">Email: <a href="mailto:support@gokez.com" className="text-emerald-600 dark:text-emerald-400 hover:underline">support@gokez.com</a></p>
              <p className="text-gray-600 dark:text-slate-400">Kolkata, West Bengal, India</p>
              <p className="text-xs text-gray-500 dark:text-slate-400 mt-2">Please include your contact details and a clear description of your request. We will review and respond in accordance with applicable law.</p>
            </div>
          </section>

        </div>
      </div>
    </div>
  );
}
