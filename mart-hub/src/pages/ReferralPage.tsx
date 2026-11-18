import type { ComponentType } from 'react';
import { useSearchParams } from 'react-router-dom';
import { BarChart3, BadgePercent, CreditCard, Gift, LayoutList, Shield, Users } from 'lucide-react';
import ReferralOverviewPage from './ReferralOverviewPage';
import ReferralCampaignsPage from './ReferralCampaignsPage';
import ReferralRecordsPage from './ReferralRecordsPage';
import ReferralCustomerRewardsPage from './ReferralCustomerRewardsPage';
import ReferralRewardsLedgerPage from './ReferralRewardsLedgerPage';
import ReferralFraudPage from './ReferralFraudPage';
import ReferralReportsPage from './ReferralReportsPage';

const TAB_IDS = ['overview', 'campaigns', 'records', 'customers', 'ledger', 'fraud', 'reports'] as const;

type TabId = typeof TAB_IDS[number];

type ReferralTab = {
  id: TabId;
  label: string;
  icon: ComponentType<{ className?: string }>;
  panel: ComponentType<{ embedded?: boolean }>;
};

const TABS: ReferralTab[] = [
  { id: 'overview', label: 'Overview', icon: Gift, panel: ReferralOverviewPage },
  { id: 'campaigns', label: 'Configuration', icon: BadgePercent, panel: ReferralCampaignsPage },
  { id: 'records', label: 'Records', icon: LayoutList, panel: ReferralRecordsPage },
  { id: 'customers', label: 'Customers', icon: Users, panel: ReferralCustomerRewardsPage },
  { id: 'ledger', label: 'Ledger', icon: CreditCard, panel: ReferralRewardsLedgerPage },
  { id: 'fraud', label: 'Fraud', icon: Shield, panel: ReferralFraudPage },
  { id: 'reports', label: 'Analytics', icon: BarChart3, panel: ReferralReportsPage },
];

export default function ReferralPage() {
  const [params, setParams] = useSearchParams();
  const requested = params.get('tab');
  const active = TAB_IDS.find(id => id === requested) || 'overview';
  const activeTab = TABS.find(tab => tab.id === active)!;
  const Panel = activeTab.panel;

  const selectTab = (id: TabId) => setParams({ tab: id }, { replace: true });

  return (
    <div className="space-y-4">
      <div role="tablist" aria-label="Referral views" className="flex w-fit max-w-full gap-1 overflow-x-auto rounded-lg border border-gray-200 bg-gray-50 p-1 dark:border-slate-700 dark:bg-slate-800">
        {TABS.map(tab => {
          const Icon = tab.icon;
          const selected = tab.id === active;
          return (
            <button
              key={tab.id}
              id={`referral-${tab.id}-tab`}
              role="tab"
              type="button"
              aria-selected={selected}
              aria-controls={`referral-${tab.id}-panel`}
              onClick={() => selectTab(tab.id)}
              className={`flex min-w-0 flex-shrink-0 items-center gap-1 whitespace-nowrap rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
                selected
                  ? 'bg-white text-emerald-700 shadow-sm dark:bg-slate-700 dark:text-emerald-300'
                  : 'text-gray-600 hover:bg-gray-100 dark:text-slate-300 dark:hover:bg-slate-700'
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              {tab.label}
            </button>
          );
        })}
      </div>

      <div id={`referral-${active}-panel`} role="tabpanel" aria-labelledby={`referral-${active}-tab`}>
        <Panel embedded />
      </div>
    </div>
  );
}
