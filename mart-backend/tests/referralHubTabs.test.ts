import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const readHub = (rel: string) => readFileSync(join(__dirname, '..', '..', 'mart-hub', 'src', rel), 'utf8');

const OLD_PATHS = [
  '/referral-overview',
  '/referral-campaigns',
  '/referral-records',
  '/referral-customer-rewards',
  '/referral-ledger',
  '/referral-fraud',
  '/referral-reports',
];

const PANELS = [
  'ReferralOverviewPage',
  'ReferralCampaignsPage',
  'ReferralRecordsPage',
  'ReferralCustomerRewardsPage',
  'ReferralRewardsLedgerPage',
  'ReferralFraudPage',
  'ReferralReportsPage',
];

describe('Referral hub consolidation', () => {
  test('one protected route replaces the seven referral routes and keeps deep links', () => {
    const app = readHub('App.tsx');
    assert.ok(app.includes("const ReferralPage = lazyWithRetry(() => import('./pages/ReferralPage'));"));
    assert.ok(app.includes('<Route path="/referrals"        element={<ProtectedRoute path="/referrals"><ReferralPage /></ProtectedRoute>} />'));
    assert.ok(app.includes("'/home-sections', '/referrals', '/profile'"));

    const redirectTabs = [
      ['/referral-overview', 'overview'],
      ['/referral-campaigns', 'campaigns'],
      ['/referral-records', 'records'],
      ['/referral-customer-rewards', 'customers'],
      ['/referral-ledger', 'ledger'],
      ['/referral-fraud', 'fraud'],
      ['/referral-reports', 'reports'],
    ];
    for (const [path, tab] of redirectTabs) {
      assert.ok(app.includes(`<Route path="${path}" element={<Navigate to="/referrals?tab=${tab}" replace />} />`));
    }
  });

  test('the sidebar exposes a single Referral & Earn entry', () => {
    const layout = readHub('components/Layout.tsx');
    assert.ok(layout.includes("{ label: 'Referral & Earn',   href: '/referrals',"));
    assert.ok(layout.includes("'/referrals': 'Referral & Earn'"));
    assert.ok(layout.includes("'/home-sections', '/referrals'].includes(pathname)"));
    for (const path of OLD_PATHS) assert.ok(!layout.includes(`href: '${path}'`));
  });

  test('the referral page tabs cover configuration, funnel and analytics', () => {
    const page = readHub('pages/ReferralPage.tsx');
    assert.ok(page.includes('useSearchParams'));
    assert.ok(!page.includes('<h1'));
    assert.ok(page.includes('role="tablist"'));
    assert.ok(page.includes('<Panel embedded />'));
    assert.ok(page.includes("const TAB_IDS = ['overview', 'campaigns', 'records', 'customers', 'ledger', 'fraud', 'reports'] as const"));
    for (const label of ['Overview', 'Configuration', 'Records', 'Customers', 'Ledger', 'Fraud', 'Analytics']) {
      assert.ok(page.includes(`label: '${label}'`));
    }
    for (const panel of PANELS) assert.ok(page.includes(`panel: ${panel}`));
  });

  test('every referral panel can hide its duplicate title when embedded', () => {
    for (const panel of PANELS) {
      const source = readHub(`pages/${panel}.tsx`);
      assert.ok(source.includes('{ embedded = false }: { embedded?: boolean }'));
      assert.ok(source.includes('<PanelHeader embedded={embedded}'));
    }
  });

  test('referral filters use the shared Hub search and date pattern', () => {
    const ui = readHub('components/referralUi.tsx');
    const dateUi = readHub('components/DateRangeFilter.tsx');
    assert.ok(ui.includes('export function SearchField'));
    assert.ok(ui.includes("export { DateRangeFilter, DateRangeChips, CustomDateInputs, DATE_RANGE_OPTIONS, istDay } from './DateRangeFilter'"));
    assert.ok(ui.includes('export function useDebounced'));
    assert.ok(ui.includes('kpi-card h-full cursor-default'));
    assert.ok(dateUi.includes("timeZone: 'Asia/Kolkata'"));
    assert.ok(dateUi.includes("const DATE_RANGE_OPTIONS: { id: DateRangeId; label: string; mobileLabel?: string }[] = [\n  { id: 'today', label: 'Today' },\n  { id: 'yesterday', label: 'Yesterday', mobileLabel: \"Y'Day\" },\n  { id: 'all', label: 'All' },\n  { id: 'custom', label: 'Custom' },\n]"));
    assert.ok(dateUi.includes('const [customMode, setCustomMode] = useState'));
    assert.ok(dateUi.includes("else if (id === 'custom') { setCustomMode(true)"));
    assert.ok(ui.includes('w-full rounded-xl border border-gray-200 bg-white py-2 pl-9 pr-8 text-xs'));
    assert.ok(dateUi.includes('inline-flex shrink-0 flex-wrap gap-1 rounded-lg border border-gray-200 bg-gray-50 p-1'));
    assert.ok(dateUi.includes('inline-flex items-center justify-center whitespace-nowrap rounded-md border px-2 py-1.5 text-xs font-bold transition-colors sm:px-2.5'));
    assert.ok(dateUi.includes('border-emerald-500 bg-emerald-500 text-white'));
    assert.ok(dateUi.includes('border-gray-200 text-gray-600 dark:border-slate-600 dark:text-slate-300'));
    assert.ok(dateUi.includes('text-xs font-medium text-gray-600 dark:text-slate-300">From'));

    for (const panel of ['ReferralRecordsPage', 'ReferralCustomerRewardsPage', 'ReferralRewardsLedgerPage']) {
      assert.ok(readHub(`pages/${panel}.tsx`).includes('<SearchField'));
    }
    for (const panel of ['ReferralOverviewPage', 'ReferralRecordsPage', 'ReferralRewardsLedgerPage', 'ReferralReportsPage']) {
      assert.ok(readHub(`pages/${panel}.tsx`).includes('<DateRangeFilter'));
    }
  });

  test('Hub date chips are shared across dashboard, orders and analytics pages', () => {
    const dateUi = readHub('components/DateRangeFilter.tsx');
    assert.ok(dateUi.includes('export function DateRangeChips'));
    assert.ok(dateUi.includes('export function CustomDateInputs'));
    assert.ok(dateUi.includes('export function ScheduledFilterButton'));
    assert.ok(!dateUi.includes('CalendarClock'));
    assert.ok(dateUi.includes('rounded-full px-1.5 py-0.5 text-[10px] font-bold'));
    assert.ok(dateUi.includes('mobileLabel: "Y\'Day"'));
    assert.ok(dateUi.includes('className="sm:hidden"'));
    assert.ok(dateUi.includes('className="hidden sm:inline"'));

    for (const page of [
      'DashboardPage.tsx', 'OrdersPage.tsx', 'CustomersPage.tsx', 'AnalyticsPage.tsx',
      'CustomerLeadsPage.tsx', 'DailySalesPage.tsx', 'InstallAnalyticsPage.tsx',
      'components/FunnelPanel.tsx',
    ]) {
      assert.ok(readHub(page.startsWith('components/') ? page : `pages/${page}`).includes('<DateRangeChips'));
    }
    for (const page of ['DashboardPage.tsx', 'OrdersPage.tsx']) {
      const source = readHub(`pages/${page}`);
      assert.ok(/<div className="flex min-w-0 items-center gap-2 overflow-x-auto">[\s\S]*?<DateRangeChips[\s\S]*?showCustomInputs={false}[\s\S]*?<ScheduledFilterButton[\s\S]*?<\/div>/.test(source));
      assert.ok(source.includes('<CustomDateInputs'));
      assert.ok(source.includes('scheduledCount'));
      assert.ok(!source.includes('Scheduled orders not delivered'));
    }
  });

  test('overview keeps only outcome and financial KPIs', () => {
    const overview = readHub('pages/ReferralOverviewPage.tsx');
    for (const label of ['Total Referrals', 'Qualified / Rewarded', 'Pending', 'Conversion Rate', 'Available Liability', 'Redeemed']) {
      assert.ok(overview.includes(`label="${label}"`));
    }
    for (const label of ['Capped', 'Rejected', 'Total Rewards Issued', 'Expired / Reversed']) {
      assert.ok(!overview.includes(`label="${label}"`));
    }
  });

  test('the referral tab bar matches the Hub view-tab style', () => {
    const page = readHub('pages/ReferralPage.tsx');
    assert.ok(page.includes('flex w-fit max-w-full gap-1 overflow-x-auto rounded-lg border border-gray-200 bg-gray-50 p-1'));
    assert.ok(page.includes('whitespace-nowrap rounded-md px-3 py-1.5 text-xs font-semibold'));
    assert.ok(page.includes('bg-white text-emerald-700 shadow-sm dark:bg-slate-700 dark:text-emerald-300'));
  });

  test('inventory status pills match the Hub date chip style', () => {
    const page = readHub('pages/InventoryPage.tsx');
    assert.ok(page.includes('inline-flex shrink-0 flex-wrap gap-1 rounded-lg border border-gray-200 bg-gray-50 p-1'));
    assert.ok(page.includes('inline-flex items-center justify-center whitespace-nowrap rounded-md border px-2 py-1.5 text-xs font-bold transition-colors sm:px-2.5'));
    assert.ok(page.includes('border-emerald-500 bg-emerald-500 text-white'));
    assert.ok(page.includes('border-gray-200 text-gray-600 dark:border-slate-600 dark:text-slate-300'));
    assert.ok(!page.includes('rounded-full px-3 py-1 text-xs font-semibold transition-all'));
  });

  test('top selling range tabs match the Hub date chip style', () => {
    const page = readHub('pages/TopSellingProductsPage.tsx');
    assert.ok(page.includes('inline-flex shrink-0 flex-wrap gap-1 rounded-lg border border-gray-200 bg-gray-50 p-1'));
    assert.ok(page.includes('inline-flex items-center justify-center whitespace-nowrap rounded-md border px-2 py-1.5 text-xs font-bold transition-colors sm:px-2.5'));
    assert.ok(page.includes('border-emerald-500 bg-emerald-500 text-white'));
    assert.ok(page.includes('border-gray-200 text-gray-600 dark:border-slate-600 dark:text-slate-300'));
    assert.ok(!page.includes('border-b border-gray-200 dark:border-slate-700 pb-2'));
  });

  test('cross-links and ledger filters stay inside the consolidated page', () => {
    const customer = readHub('pages/ReferralCustomerRewardsPage.tsx');
    assert.ok(customer.includes('/referrals?tab=ledger&customerId='));

    const ledger = readHub('pages/ReferralRewardsLedgerPage.tsx');
    assert.ok(ledger.includes("setParams({ tab: 'ledger' }, { replace: true });"));
  });
});
