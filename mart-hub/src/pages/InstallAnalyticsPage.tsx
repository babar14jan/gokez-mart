import { useEffect, useState, useCallback } from 'react';
import { Smartphone, MonitorSmartphone, CheckCircle, XCircle, HelpCircle, Trash2, Users } from 'lucide-react';
import { installAnalyticsApi } from '../services/api';

type DateRange = 'today' | '7d' | '30d' | 'all';

interface InstallSummary {
  byPlatform: { platform: string; events: string; sessions: string }[];
  byEvent: { event_name: string; platform: string; count: string }[];
  totals: { total_events: string; total_sessions: string };
  uniqueVisitors: { platform: string; unique_visitors: string }[];
}

const EMPTY: InstallSummary = {
  byPlatform: [],
  byEvent: [],
  totals: { total_events: '0', total_sessions: '0' },
  uniqueVisitors: [],
};

function StatCard({ label, value, sub, icon }: { label: string; value: string | number; sub?: string; icon: React.ReactNode }) {
  return (
    <div className="bg-white dark:bg-slate-800 rounded-xl border border-gray-200 dark:border-slate-700 p-4">
      <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-emerald-400 to-emerald-600 flex items-center justify-center text-white mb-3">{icon}</div>
      <p className="text-xl font-bold text-gray-900 dark:text-white leading-none">{value}</p>
      <p className="text-xs text-gray-500 mt-1">{label}</p>
      {sub && <p className="text-[10px] text-gray-400 mt-0.5">{sub}</p>}
    </div>
  );
}

export default function InstallAnalyticsPage() {
  const [range, setRange] = useState<DateRange>('7d');
  const [data, setData] = useState<InstallSummary>(EMPTY);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await installAnalyticsApi.getSummary();
      setData(res.data?.data ?? EMPTY);
    } catch {
      setData(EMPTY);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const androidVisitors = Number(data.uniqueVisitors.find(v => v.platform === 'android')?.unique_visitors ?? 0);
  const iosVisitors = Number(data.uniqueVisitors.find(v => v.platform === 'ios')?.unique_visitors ?? 0);

  const getEvent = (name: string, platform: string) =>
    Number(data.byEvent.find(e => e.event_name === name && e.platform === platform)?.count ?? 0);

  const androidShown = getEvent('install_prompt_shown', 'android');
  const androidAccepted = getEvent('install_prompt_accepted', 'android');
  const androidDeclined = getEvent('install_prompt_declined', 'android');
  const androidInstalled = getEvent('app_installed', 'android');

  const iosShown = getEvent('install_prompt_shown', 'ios');
  const iosGuideOpened = getEvent('install_guide_opened', 'ios');
  const iosGuideDismissed = getEvent('install_guide_dismissed', 'ios');
  const iosDeclined = getEvent('install_prompt_declined', 'ios');
  const iosInstalled = getEvent('app_installed', 'ios');

  const acceptRate = androidShown > 0 ? Math.round((androidAccepted / androidShown) * 100) : 0;
  const declineRate = androidShown > 0 ? Math.round((androidDeclined / androidShown) * 100) : 0;

  return (
    <div className="p-4 md:p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-bold text-gray-900 dark:text-white">Install Analytics</h1>
        <select value={range} onChange={e => setRange(e.target.value as DateRange)}
          className="text-sm border border-gray-200 dark:border-slate-700 rounded-lg px-3 py-1.5 bg-white dark:bg-slate-800 text-gray-700 dark:text-slate-200">
          <option value="today">Today</option>
          <option value="7d">Last 7 days</option>
          <option value="30d">Last 30 days</option>
          <option value="all">All time</option>
        </select>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Android Visitors" value={androidVisitors} icon={<Smartphone className="w-4 h-4" />} />
        <StatCard label="iOS Visitors" value={iosVisitors} icon={<MonitorSmartphone className="w-4 h-4" />} />
        <StatCard label="Total Events" value={data.totals.total_events} icon={<Users className="w-4 h-4" />} />
        <StatCard label="Total Sessions" value={data.totals.total_sessions} icon={<Users className="w-4 h-4" />} />
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-gray-200 dark:border-slate-700 p-4">
          <h2 className="text-sm font-bold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
            <Smartphone className="w-4 h-4 text-emerald-500" /> Android
          </h2>
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs text-gray-500 flex items-center gap-1.5"><HelpCircle className="w-3.5 h-3.5" /> Prompt Shown</span>
              <span className="text-sm font-bold text-gray-900 dark:text-white">{androidShown}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs text-gray-500 flex items-center gap-1.5"><CheckCircle className="w-3.5 h-3.5 text-emerald-500" /> Accepted</span>
              <span className="text-sm font-bold text-emerald-600">{androidAccepted}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs text-gray-500 flex items-center gap-1.5"><XCircle className="w-3.5 h-3.5 text-red-500" /> Declined (Not now)</span>
              <span className="text-sm font-bold text-red-500">{androidDeclined}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs text-gray-500 flex items-center gap-1.5"><Trash2 className="w-3.5 h-3.5" /> Installed</span>
              <span className="text-sm font-bold text-gray-900 dark:text-white">{androidInstalled}</span>
            </div>
            <div className="border-t border-gray-100 dark:border-slate-700 pt-3">
              <div className="flex items-center justify-between text-xs">
                <span className="text-gray-500">Accept Rate</span>
                <span className="font-bold text-emerald-600">{acceptRate}%</span>
              </div>
              <div className="flex items-center justify-between text-xs mt-1">
                <span className="text-gray-500">Decline Rate</span>
                <span className="font-bold text-red-500">{declineRate}%</span>
              </div>
            </div>
          </div>
        </div>

        <div className="bg-white dark:bg-slate-800 rounded-xl border border-gray-200 dark:border-slate-700 p-4">
          <h2 className="text-sm font-bold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
            <MonitorSmartphone className="w-4 h-4 text-blue-500" /> iOS
          </h2>
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs text-gray-500 flex items-center gap-1.5"><HelpCircle className="w-3.5 h-3.5" /> Prompt Shown</span>
              <span className="text-sm font-bold text-gray-900 dark:text-white">{iosShown}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs text-gray-500 flex items-center gap-1.5"><CheckCircle className="w-3.5 h-3.5 text-emerald-500" /> Guide Opened</span>
              <span className="text-sm font-bold text-emerald-600">{iosGuideOpened}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs text-gray-500 flex items-center gap-1.5"><XCircle className="w-3.5 h-3.5 text-red-500" /> Guide Dismissed</span>
              <span className="text-sm font-bold text-red-500">{iosGuideDismissed}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs text-gray-500 flex items-center gap-1.5"><XCircle className="w-3.5 h-3.5 text-red-400" /> Declined (Not now)</span>
              <span className="text-sm font-bold text-red-400">{iosDeclined}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs text-gray-500 flex items-center gap-1.5"><Trash2 className="w-3.5 h-3.5" /> Installed</span>
              <span className="text-sm font-bold text-gray-900 dark:text-white">{iosInstalled}</span>
            </div>
          </div>
        </div>
      </div>

      {loading && <p className="text-xs text-gray-400 text-center">Loading...</p>}
    </div>
  );
}
