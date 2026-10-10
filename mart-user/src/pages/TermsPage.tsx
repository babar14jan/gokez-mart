export default function TermsPage({ embed = false }: { embed?: boolean } = {}) {
  const updated = 'October 2026';
  return (
    <div className="page-shell bg-gray-50 dark:bg-slate-900 font-sans">
      {!embed && (
        <div className="sticky top-0 z-10 bg-white dark:bg-slate-900 border-b border-gray-100 dark:border-slate-800 px-4 py-3 flex items-center gap-3">
          <button onClick={() => window.history.back()}
            className="p-1.5 rounded-xl hover:bg-gray-100 dark:hover:bg-slate-800 transition-colors">
            <svg className="w-5 h-5 text-gray-600 dark:text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
          </button>
          <h1 className="text-sm font-bold text-gray-900 dark:text-white">Terms of Service</h1>
        </div>
      )}
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6 pb-36">
        <p className="text-xs text-gray-500 dark:text-slate-400 mb-8">Last updated: {updated}</p>

        <div className="space-y-8 text-sm text-gray-600 dark:text-slate-400 leading-relaxed">

          <section>
            <h2 className="text-base font-bold text-gray-900 dark:text-white mb-2">1. Acceptance</h2>
            <p>By using Gokez Mart, you agree to these Terms of Service. Gokez Mart is operated by <strong className="text-gray-800 dark:text-slate-200">Gokez Technologies Pvt. Ltd.</strong> If you do not agree, please do not use the service.</p>
          </section>

          <section>
            <h2 className="text-base font-bold text-gray-900 dark:text-white mb-2">2. Service Description</h2>
            <p>Gokez Mart is a technology marketplace operating in select areas of Kolkata. It helps customers discover and place orders with independent local stores. The store identified on an order is the seller and fulfiller of that order; Gokez provides the platform, order-routing and support tools.</p>
          </section>

          <section>
            <h2 className="text-base font-bold text-gray-900 dark:text-white mb-2">3. Eligibility</h2>
            <ul className="list-disc list-inside space-y-1.5">
              <li>You must be 18 years or older to place orders</li>
              <li>You must provide a valid Indian mobile number for OTP verification</li>
              <li>Your delivery address must be within one of our active delivery zones</li>
            </ul>
          </section>

          <section>
            <h2 className="text-base font-bold text-gray-900 dark:text-white mb-2">4. Orders, Seller & Delivery</h2>
            <ul className="list-disc list-inside space-y-1.5">
              <li>Orders are subject to the selected store's product availability, acceptance and delivery-zone coverage</li>
              <li>The seller and fulfiller is displayed with your order. That merchant is responsible for product selection, packing, quality, fulfilment and its delivery personnel</li>
              <li>Estimated delivery times are indicative and may vary based on demand and distance</li>
              <li>The merchant may decline or cancel an order where fulfilment or delivery is not feasible</li>
              <li>You must provide an accurate delivery address. We are not responsible for failed deliveries due to incorrect addresses</li>
            </ul>
          </section>

          <section>
            <h2 className="text-base font-bold text-gray-900 dark:text-white mb-2">5. Pricing & Payments</h2>
            <ul className="list-disc list-inside space-y-1.5">
              <li>Prices, delivery charges and applicable taxes are set or confirmed by the merchant and shown with the order where available</li>
              <li>Delivery charges apply as shown at checkout. Orders above the free delivery threshold qualify for free delivery</li>
              <li>Payment is made directly to the merchant using the merchant's stated cash or UPI method. Gokez Mart does not receive, hold, settle or process customer payments for merchant goods</li>
              <li>Prices may change without prior notice</li>
            </ul>
          </section>

          <section>
            <h2 className="text-base font-bold text-gray-900 dark:text-white mb-2">6. Cancellations & Refunds</h2>
            <ul className="list-disc list-inside space-y-1.5">
              <li>Orders can be cancelled before they are confirmed by the store</li>
              <li>Once an order is confirmed or out for delivery, cancellation may not be possible</li>
              <li>Refunds, replacements and payment reversals for goods are handled by the merchant that received the payment. Gokez may help route a support request but does not promise or process a merchant refund</li>
              <li>For damaged or incorrect items, contact the merchant promptly using the order support details. You may also contact <a href="mailto:support@gokez.com" className="text-emerald-600 dark:text-emerald-400 hover:underline">support@gokez.com</a> for platform support</li>
            </ul>
          </section>

          <section>
            <h2 className="text-base font-bold text-gray-900 dark:text-white mb-2">7. Acceptable Use</h2>
            <p>You agree not to:</p>
            <ul className="list-disc list-inside space-y-1.5 mt-2">
              <li>Place fraudulent or fake orders</li>
              <li>Abuse promotional offers or referral programs</li>
              <li>Use the service for any unlawful purpose</li>
              <li>Attempt to reverse engineer or interfere with the platform</li>
            </ul>
          </section>

          <section>
            <h2 className="text-base font-bold text-gray-900 dark:text-white mb-2">8. Limitation of Liability</h2>
            <p>To the extent permitted by applicable law, Gokez Mart is not the seller and is not responsible for:</p>
            <ul className="list-disc list-inside space-y-1.5 mt-2">
              <li>Delays caused by traffic, weather, or other factors beyond our control</li>
              <li>Merchant product quality, quantity, pricing, packing, delivery conduct or merchant payment handling</li>
              <li>Any indirect or consequential damages arising from use of the service</li>
            </ul>
          </section>

          <section>
            <h2 className="text-base font-bold text-gray-900 dark:text-white mb-2">9. Changes to Terms</h2>
            <p>We may update these terms by posting the revised version here. Continued use after the effective date means you accept the updated terms. Where practical, material changes will also be notified in the app or website.</p>
          </section>

          <section>
            <h2 className="text-base font-bold text-gray-900 dark:text-white mb-2">10. Governing Law</h2>
            <p>These terms are governed by the laws of India. Any disputes shall be subject to the exclusive jurisdiction of courts in Kolkata, West Bengal.</p>
          </section>

          <section>
            <h2 className="text-base font-bold text-gray-900 dark:text-white mb-2">11. Contact</h2>
            <div className="bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-100 dark:border-emerald-800 rounded-xl p-4">
              <p className="font-semibold text-gray-800 dark:text-white mb-2">Gokez Technologies Pvt. Ltd.</p>
              <p className="text-gray-600 dark:text-slate-400">Email: <a href="mailto:support@gokez.com" className="text-emerald-600 dark:text-emerald-400 hover:underline">support@gokez.com</a></p>
              <p className="text-gray-600 dark:text-slate-400">Kolkata, West Bengal, India</p>
            </div>
          </section>

        </div>
      </div>
    </div>
  );
}
