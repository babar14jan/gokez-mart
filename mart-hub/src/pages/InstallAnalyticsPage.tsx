import { useEffect, useState, useCallback, useMemo } from 'react';
import { Smartphone, MonitorSmartphone, CheckCircle, XCircle, HelpCircle, Trash2, Users } from 'lucide-react';
import { installAnalyticsApi } from '../services/api';

type DateRange = 'today' | '7d' | '30d' | 'all' | 'custom';

const RANGES: { key: DateRange; label: string }[] = [
  { key: 'today', label: 'Today' },
  { key: '7d', label: '7D' },
  { key: '30d', label: '30D' },
  { key: 'all', label: 'All' },
  { key: 'custom', label: 'Custom' },
];

// A local calendar day turned into an ISO instant the backend can compare
// against `created_at` (TIMESTAMPTZ). `end` picks 23:59:59.999 so the whole day
// is included.
function dayBound(dateStr: string, end: boolean): string | undefined {
  const parts = dateStr.split('-').map(Number);
  if (parts.length !== 3 || parts.some(n => !Number.isFinite(n))) return undefined;
  const [y, m, d] = parts;
  return new Date(
    y, m - 1, d,
    end ? 23 : 0, end ? 59 : 0, end ? 59 : 0, end ? 999 : 0,
  ).toISOString();
}

// Map the selected range to the from/to query the API expects. Returning no
// bounds means "all time".
function rangeBounds(range: DateRange, customFrom: string, customTo: string): { from?: string; to?: string } {
  if (range === 'all') return {};
  if (range === 'custom') return { from: dayBound(customFrom, false), to: dayBound(customTo, true) };
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (range === '7d') from.setDate(from.getDate() - 6);
  if (range === '30d') from.setDate(from.getDate() - 29);
  return { from: from.toISOString(), to: now.toISOString() };
}

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
      <div className="flex items-center gap-2.5 min-w-0">
        <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-emerald-400 to-emerald-600 flex items-center justify-center text-white flex-shrink-0">{icon}</div>
        <p className="text-xl font-bold text-gray-900 dark:text-white leading-none truncate">{value}</p>
      </div>
      <p className="text-xs text-gray-500 mt-1.5">{label}</p>
      {sub && <p className="text-[10px] text-gray-400 mt-0.5">{sub}</p>}
    </div>
  );
}

export default function InstallAnalyticsPage() {
  const [range, setRange] = useState<DateRange>('7d');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [data, setData] = useState<InstallSummary>(EMPTY);
  const [loading, setLoading] = useState(true);

  const bounds = useMemo(
    () => rangeBounds(range, customFrom, customTo),
    [range, customFrom, customTo],
  );

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await installAnalyticsApi.getSummary(bounds.from, bounds.to);
      setData(res.data?.data ?? EMPTY);
    } catch {
      setData(EMPTY);
    } finally {
      setLoading(false);
    }
  }, [bounds.from, bounds.to]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const androidVisitors = Number(data.uniqueVisitors.find(v => v.platform === 'android')?.unique_visitors ?? 0);
  const iosVisitors = Number(data.uniqueVisitors.find(v => v.platform === 'ios')?.unique_visitors ?? 0);

  const getEvent = (name: string, platform: string) =>
    Number(data.byEvent.find(e => e.event_name === name && e.platform === platform)?.count ?? 0);

  const androidShown = getEvent('install_prompt_shown', 'android');
  const androidGuideOpened = getEvent('install_guide_opened', 'android');
  const androidGuideDismissed = getEvent('install_guide_dismissed', 'android');
  const androidInstalled = getEvent('app_installed', 'android');

  const iosShown = getEvent('install_prompt_shown', 'ios');
  const iosGuideOpened = getEvent('install_guide_opened', 'ios');
  const iosGuideDismissed = getEvent('install_guide_dismissed', 'ios');
  const iosInstalled = getEvent('app_installed', 'ios');

  return (
    <div className="p-4 md:p-6 space-y-6">
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-1.5">
          {RANGES.map(r => (
            <button
              key={r.key}
              type="button"
              onClick={() => setRange(r.key)}
              aria-pressed={range === r.key}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
                range === r.key
                  ? 'bg-emerald-600 text-white border-emerald-600'
                  : 'bg-white dark:bg-slate-800 text-gray-600 dark:text-slate-300 border-gray-200 dark:border-slate-700 hover:bg-gray-50 dark:hover:bg-slate-700'
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>

        {range === 'custom' && (
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="date"
              value={customFrom}
              max={customTo || undefined}
              onChange={e => setCustomFrom(e.target.value)}
              className="text-sm border border-gray-200 dark:border-slate-700 rounded-lg px-3 py-1.5 bg-white dark:bg-slate-800 text-gray-700 dark:text-slate-200"
            />
            <span className="text-xs text-gray-400">to</span>
            <input
              type="date"
              value={customTo}
              min={customFrom || undefined}
              onChange={e => setCustomTo(e.target.value)}
              className="text-sm border border-gray-200 dark:border-slate-700 rounded-lg px-3 py-1.5 bg-white dark:bg-slate-800 text-gray-700 dark:text-slate-200"
            />
          </div>
        )}
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
              <span className="text-xs text-gray-500 flex items-center gap-1.5"><CheckCircle className="w-3.5 h-3.5 text-emerald-500" /> Guide Opened</span>
              <span className="text-sm font-bold text-emerald-600">{androidGuideOpened}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs text-gray-500 flex items-center gap-1.5"><XCircle className="w-3.5 h-3.5 text-red-500" /> Guide Dismissed</span>
              <span className="text-sm font-bold text-red-500">{androidGuideDismissed}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs text-gray-500 flex items-center gap-1.5"><Trash2 className="w-3.5 h-3.5" /> Installed</span>
              <span className="text-sm font-bold text-gray-900 dark:text-white">{androidInstalled}</span>
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
