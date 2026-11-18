import { useEffect, useState } from 'react';

export type DateRangeId = 'today' | 'yesterday' | 'all' | 'custom';

export const DATE_RANGE_OPTIONS: { id: DateRangeId; label: string; mobileLabel?: string }[] = [
  { id: 'today', label: 'Today' },
  { id: 'yesterday', label: 'Yesterday', mobileLabel: "Y'Day" },
  { id: 'all', label: 'All' },
  { id: 'custom', label: 'Custom' },
];

export const istDay = (offsetDays = 0) => {
  const parts = new Intl.DateTimeFormat('en', {
    timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date(Date.now() + offsetDays * 86400000));
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find(part => part.type === type)?.value || '';
  return `${value('year')}-${value('month')}-${value('day')}`;
};

export function DateRangeChips({ active, onSelect, from, to, onFromChange, onToChange, showCustomInputs = true }: {
  active: string;
  onSelect: (id: DateRangeId) => void;
  from?: string;
  to?: string;
  onFromChange?: (value: string) => void;
  onToChange?: (value: string) => void;
  showCustomInputs?: boolean;
}) {
  return (
    <>
      <div className="inline-flex shrink-0 flex-wrap gap-1 rounded-lg border border-gray-200 bg-gray-50 p-1 dark:border-slate-700 dark:bg-slate-900/40">
        {DATE_RANGE_OPTIONS.map(option => (
          <button key={option.id} type="button" aria-label={option.label} aria-pressed={active === option.id}
            onClick={() => onSelect(option.id)}
            className={`inline-flex items-center justify-center whitespace-nowrap rounded-md border px-2 py-1.5 text-xs font-bold transition-colors sm:px-2.5 ${
              active === option.id
                ? 'border-emerald-500 bg-emerald-500 text-white'
                : 'border-gray-200 text-gray-600 dark:border-slate-600 dark:text-slate-300'
            }`}>
            {option.mobileLabel ? (
              <>
                <span className="hidden sm:inline">{option.label}</span>
                <span className="sm:hidden">{option.mobileLabel}</span>
              </>
            ) : option.label}
          </button>
        ))}
      </div>
      {showCustomInputs && <CustomDateInputs active={active} from={from} to={to} onFromChange={onFromChange} onToChange={onToChange} />}
    </>
  );
}

export function CustomDateInputs({ active, from, to, onFromChange, onToChange }: {
  active: string;
  from?: string;
  to?: string;
  onFromChange?: (value: string) => void;
  onToChange?: (value: string) => void;
}) {
  if (active !== 'custom' || !onFromChange || !onToChange) return null;
  return (
    <div className="flex flex-wrap items-end gap-2">
      <label className="text-xs font-medium text-gray-600 dark:text-slate-300">From
        <input type="date" value={from ?? ''} max={to || undefined}
          onChange={event => onFromChange(event.target.value)}
          className="mt-1 block rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-900 dark:border-slate-600 dark:bg-slate-900 dark:text-white" />
      </label>
      <label className="text-xs font-medium text-gray-600 dark:text-slate-300">To
        <input type="date" value={to ?? ''} min={from || undefined}
          onChange={event => onToChange(event.target.value)}
          className="mt-1 block rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-900 dark:border-slate-600 dark:bg-slate-900 dark:text-white" />
      </label>
    </div>
  );
}

export function DateRangeFilter({ from, to, onChange }: {
  from: string; to: string; onChange: (from: string, to: string) => void;
}) {
  const today = istDay();
  const yesterday = istDay(-1);
  const isPreset = from === to && (from === today || from === yesterday);
  const [customMode, setCustomMode] = useState(() => Boolean(from || to) && !isPreset);

  useEffect(() => {
    if (!from && !to) setCustomMode(false);
    else if (!isPreset) setCustomMode(true);
  }, [from, to, isPreset]);

  const active: DateRangeId = customMode
    ? 'custom'
    : !from && !to
      ? 'all'
      : from === to && from === today ? 'today' : 'yesterday';

  const select = (id: DateRangeId) => {
    if (id === 'all') { setCustomMode(false); onChange('', ''); }
    else if (id === 'custom') { setCustomMode(true); if (!from || !to) onChange(today, today); }
    else { setCustomMode(false); const day = id === 'today' ? today : yesterday; onChange(day, day); }
  };

  return (
    <DateRangeChips active={active} onSelect={select} from={from} to={to}
      onFromChange={value => onChange(value, to)} onToChange={value => onChange(from, value)} />
  );
}

export function ScheduledFilterButton({ active, count, onClick }: {
  active: boolean; count: number; onClick: () => void;
}) {
  return (
    <button type="button" aria-pressed={active} onClick={onClick}
      className={`flex shrink-0 items-center gap-2 whitespace-nowrap rounded-xl px-3 py-1.5 text-xs font-semibold transition-all ${
        active
          ? 'bg-indigo-500 text-white shadow-sm'
          : 'bg-white dark:bg-slate-800 text-gray-600 dark:text-slate-400 border border-gray-200 dark:border-slate-700 hover:border-indigo-300'
      }`}>
      <span className="hidden sm:inline">Scheduled</span>
      <span className="sm:hidden">Sched</span>
      <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold ${
        active
          ? 'bg-white/20 text-white'
          : 'bg-indigo-50 text-indigo-600 dark:bg-indigo-900/30 dark:text-indigo-300'
      }`}>{count}</span>
    </button>
  );
}
