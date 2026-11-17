import { useCallback, useEffect, useState } from 'react';
import { Download, Loader2 } from 'lucide-react';
import {
  referralAdminApi, downloadReferralCsv, apiErrorMessage,
  type ReferralReportType, type ReferralReportRow,
  type ConversionReportRow, type OrdersReportRow, type CustomersReportRow, type LiabilityReportRow,
} from '../services/referralAdminApi';
import { EmptyState, StatusBadge, fmtMoney, inputClass } from '../components/referralUi';

const TYPES: Array<{ value: ReferralReportType; label: string }> = [
  { value: 'conversion', label: 'Conversion funnel' },
  { value: 'orders', label: 'Qualifying orders' },
  { value: 'customers', label: 'Top customers' },
  { value: 'liability', label: 'Credit liability' },
];

const isConversion = (row: ReferralReportRow): row is ConversionReportRow =>
  'status' in row && 'delivered' in row;
const isOrders = (row: ReferralReportRow): row is OrdersReportRow => 'day' in row;
const isCustomers = (row: ReferralReportRow): row is CustomersReportRow => 'referrals' in row && !('status' in row);
const isLiability = (row: ReferralReportRow): row is LiabilityReportRow => 'credits' in row && 'status' in row;

export default function ReferralReportsPage() {
  const [type, setType] = useState<ReferralReportType>('conversion');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [rows, setRows] = useState<ReferralReportRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [exporting, setExporting] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await referralAdminApi.getReport(type, {
        from: from || undefined, to: to || undefined,
      });
      setRows(response.items || []);
      setTotal(response.total || 0);
    } catch (e) {
      setError(apiErrorMessage(e, 'Could not load this report.'));
      setRows([]);
      setTotal(0);
    } finally { setLoading(false); }
  }, [type, from, to]);

  useEffect(() => { load(); }, [load]);

  const exportCsv = async (kind: 'records' | 'ledger') => {
    setExporting(kind);
    setError('');
    try { await downloadReferralCsv(kind); }
    catch (e) { setError(apiErrorMessage(e, 'Could not download the export.')); }
    finally { setExporting(''); }
  };

  const renderRow = (row: ReferralReportRow, index: number) => {
    if (isOrders(row)) {
      return <tr key={index} className="border-b border-gray-50 dark:border-slate-700/50">
        <td className="py-2.5 text-xs text-gray-900 dark:text-white">{row.day}</td>
        <td className="py-2.5 text-xs text-right text-gray-700 dark:text-slate-300">{row.orders}</td>
        <td className="py-2.5 text-xs text-right font-semibold text-gray-900 dark:text-white">{fmtMoney(row.value)}</td>
      </tr>;
    }
    if (isCustomers(row)) {
      return <tr key={index} className="border-b border-gray-50 dark:border-slate-700/50">
        <td className="py-2.5 text-[11px] font-mono text-gray-600 dark:text-slate-400">{row.customerId}</td>
        <td className="py-2.5 text-xs text-right text-gray-900 dark:text-white">{row.referrals}</td>
        <td className="py-2.5 text-xs text-right text-emerald-600 dark:text-emerald-400">{row.rewarded}</td>
      </tr>;
    }
    if (isLiability(row)) {
      return <tr key={index} className="border-b border-gray-50 dark:border-slate-700/50">
        <td className="py-2.5 text-[11px] font-mono text-gray-600 dark:text-slate-400">{row.customerId}</td>
        <td className="py-2.5"><StatusBadge status={row.status} /></td>
        <td className="py-2.5 text-xs text-right text-gray-900 dark:text-white">{row.credits}</td>
        <td className="py-2.5 text-xs text-right font-semibold text-gray-900 dark:text-white">{fmtMoney(row.amount)}</td>
      </tr>;
    }
    if (isConversion(row)) {
      const rate = row.count > 0 ? Math.round((row.delivered / row.count) * 100) : 0;
      return <tr key={index} className="border-b border-gray-50 dark:border-slate-700/50">
        <td className="py-2.5"><StatusBadge status={row.status} /></td>
        <td className="py-2.5 text-xs text-right text-gray-900 dark:text-white">{row.count}</td>
        <td className="py-2.5 text-xs text-right text-emerald-600 dark:text-emerald-400">{row.delivered}</td>
        <td className="py-2.5 text-xs text-right font-semibold text-gray-900 dark:text-white">{rate}%</td>
      </tr>;
    }
    return null;
  };

  const headers = type === 'orders' ? ['Day', 'Orders', 'Value']
    : type === 'customers' ? ['Customer ID', 'Referrals', 'Rewarded']
    : type === 'liability' ? ['Customer ID', 'Status', 'Credits', 'Amount']
    : ['Status', 'Count', 'Delivered', 'Rate'];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-base font-bold text-gray-900 dark:text-white">Referral Reports</h1>
          <p className="text-xs text-gray-500 dark:text-slate-400">Conversion, order, customer and credit-liability views with CSV exports.</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => exportCsv('records')} disabled={Boolean(exporting)}
            className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-white bg-emerald-500 rounded-xl hover:bg-emerald-600 disabled:opacity-50">
            <Download className="w-3.5 h-3.5" /> {exporting === 'records' ? 'Preparing…' : 'Export records'}
          </button>
          <button onClick={() => exportCsv('ledger')} disabled={Boolean(exporting)}
            className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-emerald-600 dark:text-emerald-400 border border-emerald-300 dark:border-emerald-700 rounded-xl hover:bg-emerald-50 dark:hover:bg-emerald-900/20 disabled:opacity-50">
            <Download className="w-3.5 h-3.5" /> {exporting === 'ledger' ? 'Preparing…' : 'Export ledger'}
          </button>
        </div>
      </div>

      <div className="page-card p-3 flex flex-wrap items-center gap-2">
        <select value={type} onChange={e => setType(e.target.value as ReferralReportType)}
          className={`${inputClass} w-auto text-xs py-2`}>
          {TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
        <input type="date" value={from} onChange={e => setFrom(e.target.value)} aria-label="From date"
          className={`${inputClass} w-auto text-xs py-2`} />
        <span className="text-xs text-gray-500">to</span>
        <input type="date" value={to} onChange={e => setTo(e.target.value)} aria-label="To date"
          className={`${inputClass} w-auto text-xs py-2`} />
        <span className="text-[11px] text-gray-500">{total.toLocaleString('en-IN')} rows</span>
      </div>
      {error && <p className="text-xs text-red-500">{error}</p>}

      <div className="page-card">
        <div className="page-card-header"><p className="page-card-title">{TYPES.find(t => t.value === type)?.label}</p></div>
        {loading ? (
          <div className="flex justify-center py-12"><Loader2 className="w-5 h-5 animate-spin text-emerald-500" /></div>
        ) : rows.length === 0 ? (
          <EmptyState message="No report data" hint="Try a different date range or report type." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider border-b border-gray-100 dark:border-slate-700">
                  {headers.map(h => <th key={h} className={`px-4 py-2 font-semibold ${h === 'Status' || h === 'Day' || h === 'Customer ID' ? 'text-left' : 'text-right'}`}>{h}</th>)}
                </tr>
              </thead>
              <tbody>{rows.map(renderRow)}</tbody>
            </table>
          </div>
        )}
      </div>
      <p className="text-[10px] text-gray-500 dark:text-slate-400">
        Date range inputs are passed to the backend, which currently applies them only to the orders report.
        CSV exports are authenticated downloads from the backend export endpoint.
      </p>
    </div>
  );
}
