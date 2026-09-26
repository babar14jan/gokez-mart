import { useState } from 'react';
import { Loader2, Save } from 'lucide-react';

interface AddressFields {
  house: string;
  building: string;
  locality: string;
  landmark: string;
  city: string;
  pincode: string;
}

const LABELS = ['Home', 'Work', 'Other'];
const EMPTY_ADDRESS: AddressFields = { house: '', building: '', locality: '', landmark: '', city: '', pincode: '' };
const inputClass = 'w-full px-3 py-2.5 border border-gray-200 dark:border-slate-600 rounded-xl text-sm text-gray-900 dark:text-white bg-gray-50 dark:bg-slate-700 focus:bg-white dark:focus:bg-slate-600 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all placeholder:text-gray-400';

function parseAddress(stored: string | null): AddressFields {
  if (!stored) return EMPTY_ADDRESS;
  const parts = stored.split(',').map(part => part.trim());
  const possiblePincode = parts[parts.length - 1] || '';
  const hasPincode = /^\d{6}$/.test(possiblePincode);
  return {
    house: parts[0] || '',
    building: parts[1] || '',
    locality: parts[2] || '',
    landmark: '',
    city: hasPincode ? parts[parts.length - 2] || '' : '',
    pincode: hasPincode ? possiblePincode : '',
  };
}

function serializeAddress(fields: AddressFields): string {
  return [fields.house, fields.building, fields.locality, fields.landmark, fields.city, fields.pincode]
    .map(value => value.trim())
    .filter(Boolean)
    .join(', ');
}

interface AddressFormProps {
  stored?: string | null;
  initialLabel?: string;
  saving: boolean;
  onSave: (label: string, address: string) => Promise<void>;
  onCancel: () => void;
}

export default function AddressForm({ stored = null, initialLabel = 'Home', saving, onSave, onCancel }: AddressFormProps) {
  const [label, setLabel] = useState(initialLabel);
  const [fields, setFields] = useState<AddressFields>(() => parseAddress(stored));
  const update = (key: keyof AddressFields) => (event: React.ChangeEvent<HTMLInputElement>) => {
    const value = key === 'pincode' ? event.target.value.replace(/\D/g, '').slice(0, 6) : event.target.value;
    setFields(current => ({ ...current, [key]: value }));
  };
  const complete = Boolean(fields.house.trim() && fields.locality.trim() && fields.city.trim() && /^\d{6}$/.test(fields.pincode));

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        {LABELS.map(option => (
          <button key={option} type="button" onClick={() => setLabel(option)}
            className={`flex-1 py-2 rounded-xl text-xs font-semibold border-2 transition-colors ${label === option ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600' : 'border-gray-200 dark:border-slate-600 text-gray-500 dark:text-slate-400'}`}>
            {option}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Flat / House No." required value={fields.house} onChange={update('house')} placeholder="e.g. A-204" autoFocus />
        <Field label="Building / Tower" value={fields.building} onChange={update('building')} placeholder="e.g. Block B" />
      </div>
      <Field label="Street / Locality" required value={fields.locality} onChange={update('locality')} placeholder="e.g. New Town" />
      <Field label="Landmark" value={fields.landmark} onChange={update('landmark')} placeholder="Optional" />
      <div className="grid grid-cols-2 gap-2">
        <Field label="City" required value={fields.city} onChange={update('city')} placeholder="e.g. Kolkata" />
        <Field label="Pincode" required value={fields.pincode} onChange={update('pincode')} placeholder="700102" inputMode="numeric" />
      </div>
      <div className="flex gap-2 pt-2">
        <button type="button" onClick={onCancel}
          className="flex-1 py-2.5 text-sm font-semibold text-gray-600 dark:text-slate-300 bg-gray-100 dark:bg-slate-700 rounded-xl transition-colors">
          Cancel
        </button>
        <button type="button" onClick={() => onSave(label, serializeAddress(fields))} disabled={saving || !complete}
          className="flex-1 py-2.5 text-sm font-semibold text-white bg-emerald-500 hover:bg-emerald-600 rounded-xl disabled:opacity-50 flex items-center justify-center gap-2 transition-colors">
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          {saving ? 'Saving...' : 'Save Address'}
        </button>
      </div>
    </div>
  );
}

function Field({ label, required = false, value, onChange, placeholder, autoFocus = false, inputMode }: {
  label: string;
  required?: boolean;
  value: string;
  onChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
  placeholder: string;
  autoFocus?: boolean;
  inputMode?: 'numeric';
}) {
  return (
    <div>
      <label className="block text-[10px] font-medium text-gray-500 mb-1">{label}{required ? ' *' : ''}</label>
      <input type="text" inputMode={inputMode} maxLength={inputMode === 'numeric' ? 6 : undefined} value={value} onChange={onChange}
        className={inputClass} placeholder={placeholder} autoFocus={autoFocus} />
    </div>
  );
}