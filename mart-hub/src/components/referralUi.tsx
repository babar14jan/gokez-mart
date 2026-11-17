import type { ReactNode } from 'react';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';

export const fmtMoney = (value: unknown): string =>
  `₹${Number(value ?? 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

export const fmtDate = (value: unknown, withTime = true): string => {
  if (!value) return '—';
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('en-IN', withTime
    ? { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }
    : { day: '2-digit', month: 'short', year: 'numeric' });
};

const STATUS_STYLES: Record<string, string> = {
  pending:   'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  qualified: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  rewarded:  'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
  capped:    'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400',
  rejected:  'bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400',
  expired:   'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300',
  active:    'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
  draft:     'bg-gray-100 text-gray-600 dark:bg-slate-700 dark:text-slate-300',
  paused:    'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  ended:     'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300',
};

export function StatusBadge({ status }: { status: string }) {
  const key = (status || '').toLowerCase();
  return (
    <span className={`badge capitalize ${STATUS_STYLES[key] || 'bg-gray-100 text-gray-600 dark:bg-slate-700 dark:text-slate-300'}`}>
      {key.replace(/_/g, ' ') || '—'}
    </span>
  );
}

export function KpiCard({ label, value, sub, icon, gradient }: {
  label: string; value: string | number; sub?: string; icon: ReactNode; gradient: string;
}) {
  return (
    <div className="bg-white dark:bg-slate-800 rounded-xl border border-gray-200 dark:border-slate-700 p-4">
      <div className="flex items-center gap-2.5 min-w-0">
        <div className={`w-8 h-8 rounded-lg bg-gradient-to-br ${gradient} flex items-center justify-center text-white flex-shrink-0`}>{icon}</div>
        <p className="text-xl font-bold text-gray-900 dark:text-white leading-none truncate">{value}</p>
      </div>
      <p className="text-xs text-gray-500 dark:text-slate-400 mt-1.5">{label}</p>
      {sub && <p className="text-[10px] text-gray-500 dark:text-slate-400 mt-0.5">{sub}</p>}
    </div>
  );
}

export function BarChart({ data, color = 'bg-emerald-500', valuePrefix = '' }: {
  data: Array<{ label: string; value: number; fullLabel?: string }>; color?: string; valuePrefix?: string;
}) {
  const max = Math.max(...data.map(d => d.value), 1);
  return (
    <div className="space-y-2">
      <div className="flex items-end gap-0.5 h-28">
        {data.map((d, i) => (
          <div key={i} className="flex-1 flex flex-col items-center justify-end group relative">
            <div className={`w-full rounded-t-sm ${color} hover:opacity-80 transition-all duration-300`}
              style={{ height: `${Math.max((d.value / max) * 100, d.value > 0 ? 3 : 0)}px`, opacity: d.value > 0 ? 1 : 0.1 }} />
            {d.value > 0 && (
              <div className="absolute bottom-full mb-1 left-1/2 -translate-x-1/2 bg-gray-900 text-white text-[9px] font-bold px-1.5 py-0.5 rounded whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity z-10 pointer-events-none">
                {d.fullLabel || d.label}: {valuePrefix}{d.value}
              </div>
            )}
          </div>
        ))}
      </div>
      <div className="flex gap-0.5">
        {data.map((d, i) => (
          <div key={i} className="flex-1 text-center">
            {d.label && <span className="text-[8px] text-gray-500 dark:text-slate-400">{d.label}</span>}
          </div>
        ))}
      </div>
    </div>
  );
}

export function HorizontalBars({ rows }: { rows: Array<{ label: string; value: number; detail?: string }> }) {
  const max = Math.max(...rows.map(r => r.value), 1);
  return (
    <div className="space-y-3">
      {rows.map(row => (
        <div key={row.label}>
          <div className="flex items-center justify-between mb-1 gap-2">
            <span className="text-xs font-semibold text-gray-700 dark:text-slate-300 capitalize">{row.label.replace(/_/g, ' ')}</span>
            <span className="text-xs font-bold text-gray-900 dark:text-white whitespace-nowrap">
              {row.value.toLocaleString('en-IN')}
              {row.detail && <span className="text-[10px] font-normal text-gray-500 ml-1.5">{row.detail}</span>}
            </span>
          </div>
          <div className="h-2 rounded-full bg-gray-100 dark:bg-slate-600 overflow-hidden">
            <div className="h-full bg-emerald-500 rounded-full transition-all duration-500" style={{ width: `${(row.value / max) * 100}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

export function Pagination({ total, limit, offset, onChange }: {
  total: number; limit: number; offset: number; onChange: (offset: number) => void;
}) {
  const from = total === 0 ? 0 : offset + 1;
  const to = Math.min(offset + limit, total);
  return (
    <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100 dark:border-slate-700">
      <span className="text-[11px] text-gray-500 dark:text-slate-400">
        {from}–{to} of {total.toLocaleString('en-IN')}
      </span>
      <div className="flex items-center gap-1.5">
        <button onClick={() => onChange(Math.max(0, offset - limit))} disabled={offset === 0}
          className="p-1.5 rounded-lg border border-gray-200 dark:border-slate-600 text-gray-600 dark:text-slate-300 disabled:opacity-40 hover:bg-gray-50 dark:hover:bg-slate-700">
          <ChevronLeft className="w-4 h-4" />
        </button>
        <button onClick={() => onChange(offset + limit)} disabled={to >= total}
          className="p-1.5 rounded-lg border border-gray-200 dark:border-slate-600 text-gray-600 dark:text-slate-300 disabled:opacity-40 hover:bg-gray-50 dark:hover:bg-slate-700">
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

export function DetailDrawer({ title, subtitle, onClose, children }: {
  title: string; subtitle?: string; onClose: () => void; children: ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-slate-900/50 backdrop-blur-sm" onClick={onClose}>
      <aside className="w-full sm:max-w-xl h-full bg-white dark:bg-slate-800 shadow-2xl flex flex-col"
        onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-gray-100 dark:border-slate-700 flex-shrink-0">
          <div className="min-w-0">
            <p className="text-sm font-bold text-gray-900 dark:text-white">{title}</p>
            {subtitle && <p className="text-[11px] text-gray-500 dark:text-slate-400 mt-0.5 break-all">{subtitle}</p>}
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-100 dark:hover:bg-slate-700 flex-shrink-0">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
      </aside>
    </div>
  );
}

export function FieldRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2 border-b border-gray-50 dark:border-slate-700/60 last:border-0">
      <span className="text-[11px] text-gray-500 dark:text-slate-400 flex-shrink-0">{label}</span>
      <span className="text-xs text-gray-900 dark:text-slate-100 text-right break-all">{children}</span>
    </div>
  );
}

export function EmptyState({ message, hint }: { message: string; hint?: string }) {
  return (
    <div className="py-12 text-center text-gray-400">
      <p className="text-sm">{message}</p>
      {hint && <p className="text-xs mt-1">{hint}</p>}
    </div>
  );
}

export const inputClass = 'w-full px-3 py-2 text-sm border border-gray-200 dark:border-slate-600 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 bg-white dark:bg-slate-700 text-gray-900 dark:text-white placeholder:text-gray-400';
