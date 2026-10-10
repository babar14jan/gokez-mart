import { useState } from 'react';
import { useFinePointer } from '../utils/useFinePointer';
import { Briefcase, Home, Loader2, LocateFixed, MapPin, Save } from 'lucide-react';
import { storeApi } from '../services/api';

interface AddressFields {
  house: string;
  building: string;
  locality: string;
  landmark: string;
  city: string;
  pincode: string;
}

export interface AddressCoordinates {
  latitude: number;
  longitude: number;
}

const LABELS = [
  { name: 'Home', Icon: Home },
  { name: 'Work', Icon: Briefcase },
  { name: 'Other', Icon: MapPin },
] as const;
const EMPTY_ADDRESS: AddressFields = { house: '', building: '', locality: '', landmark: '', city: '', pincode: '' };
const inputClass = 'w-full px-3 py-2.5 border border-gray-200 dark:border-slate-600 rounded-xl text-sm text-gray-900 dark:text-white bg-gray-50 dark:bg-slate-700 focus:bg-white dark:focus:bg-slate-600 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all placeholder:text-gray-400';

// Round-tripping a saved line through the form must not fabricate, drop, or
// shift segments. Only the trailing city + pincode are peeled off (when the
// last segment is a 6-digit pincode); every remaining segment keeps its slot —
// house, building, then any extra middles (including an old landmark) fold
// into locality. serializeAddress emits exactly those slots again, so editing
// any stored address yields the same line unless the shopper changes a field.
function parseAddress(stored: string | null): AddressFields {
  if (!stored) return EMPTY_ADDRESS;
  const parts = stored.split(',').map(part => part.trim());
  const possiblePincode = parts[parts.length - 1] || '';
  const hasPincode = /^\d{6}$/.test(possiblePincode);
  const body = hasPincode ? parts.slice(0, -2) : parts;
  return {
    house: body[0] || '',
    building: body[1] || '',
    locality: body.slice(2).join(', '),
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
  initialCoordinates?: AddressCoordinates | null;
  focusFirstField?: boolean;
  saving: boolean;
  onSave: (label: string, address: string, coordinates: AddressCoordinates | null) => Promise<void>;
  onCancel: () => void;
  nameSlot?: React.ReactNode;
}

export default function AddressForm({ stored = null, initialLabel = 'Home', initialCoordinates = null, focusFirstField = false, saving, onSave, onCancel, nameSlot }: AddressFormProps) {
  const [label, setLabel] = useState(initialLabel);
  const [fields, setFields] = useState<AddressFields>(() => parseAddress(stored));
  const [coordinates, setCoordinates] = useState<AddressCoordinates | null>(initialCoordinates);
  const [locating, setLocating] = useState(false);
  const [locationMessage, setLocationMessage] = useState('');
  const update = (key: keyof AddressFields) => (event: React.ChangeEvent<HTMLInputElement>) => {
    const value = key === 'pincode' ? event.target.value.replace(/\D/g, '').slice(0, 6) : event.target.value;
    setCoordinates(null);
    setFields(current => ({ ...current, [key]: value }));
  };
  const complete = Boolean(fields.house.trim() && fields.locality.trim() && fields.city.trim() && /^\d{6}$/.test(fields.pincode));

  const useCurrentLocation = () => {
    if (!navigator.geolocation) {
      setLocationMessage('Location is not supported here. Please enter your address manually.');
      return;
    }
    setLocating(true);
    setLocationMessage('');
    navigator.geolocation.getCurrentPosition(
      async position => {
        try {
          const latitude = position.coords.latitude;
          const longitude = position.coords.longitude;
          const response = await storeApi.reverseGeocode(latitude, longitude);
          const address = response.data.data;
          setFields(current => ({
            house: address.house || current.house,
            building: address.building || current.building,
            locality: address.locality || current.locality,
            landmark: address.landmark || current.landmark,
            city: address.city || current.city,
            pincode: address.pincode.match(/\d{6}/)?.[0] || current.pincode,
          }));
          setCoordinates({ latitude, longitude });
          setLocationMessage('Location details added. Please review your address.');
        } catch {
          setLocationMessage('Could not look up your location. Please enter your address manually.');
        } finally { setLocating(false); }
      },
      () => {
        setLocating(false);
        setLocationMessage('Could not get your location. Please enter your address manually.');
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
    );
  };

  return (
    <div className="space-y-3 pb-20">
      <div className="flex gap-2">
        {LABELS.map(({ name, Icon }) => (
          <button key={name} type="button" onClick={() => setLabel(name)}
            className={`flex-1 py-2 rounded-xl text-xs font-semibold border-2 transition-colors inline-flex items-center justify-center gap-1.5 ${label === name ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600' : 'border-gray-200 dark:border-slate-600 text-gray-500 dark:text-slate-400'}`}>
            <Icon className="w-3.5 h-3.5" aria-hidden="true" />
            {name}
          </button>
        ))}
      </div>
      <button type="button" onClick={useCurrentLocation} disabled={locating}
        className="w-full py-2.5 text-sm font-semibold text-emerald-600 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800 rounded-xl hover:bg-emerald-50 dark:hover:bg-emerald-900/20 disabled:opacity-50 flex items-center justify-center gap-2 transition-colors">
        <LocateFixed className={`w-4 h-4 ${locating ? 'animate-spin' : ''}`} />
        {locating ? 'Finding location...' : 'Use current location'}
      </button>
      {locationMessage && <p className="text-xs text-gray-500 dark:text-slate-400">{locationMessage}</p>}
      <p className="text-xs text-gray-500 dark:text-slate-400">Fields marked <span className="font-bold text-red-500" aria-hidden="true">*</span> are required for delivery.</p>
      {nameSlot}
      <div className="grid grid-cols-2 gap-2">
        <Field label="Flat / House No." required value={fields.house} onChange={update('house')} placeholder="Enter house number" autoFocus forceAutoFocus={focusFirstField} />
        <Field label="Building / Tower" value={fields.building} onChange={update('building')} placeholder="Building or tower" />
      </div>
      <Field label="Street / Locality" required value={fields.locality} onChange={update('locality')} placeholder="Enter street or locality" />
      <Field label="Landmark" value={fields.landmark} onChange={update('landmark')} placeholder="Nearby landmark (optional)" />
      <div className="grid grid-cols-2 gap-2">
        <Field label="City" required value={fields.city} onChange={update('city')} placeholder="Enter city" />
        <Field label="Pincode" required value={fields.pincode} onChange={update('pincode')} placeholder="Enter 6-digit pincode" inputMode="numeric" />
      </div>
      <div className="sticky bottom-0 z-10 flex gap-2 border-t border-gray-100 bg-white py-3 dark:border-slate-700 dark:bg-slate-800">
        <button type="button" onClick={onCancel}
          className="flex-1 py-2.5 text-sm font-semibold text-gray-600 dark:text-slate-300 bg-gray-100 dark:bg-slate-700 rounded-xl transition-colors">
          Cancel
        </button>
        <button type="button" onClick={() => onSave(label, serializeAddress(fields), coordinates)} disabled={saving || !complete}
          className="flex-1 py-2.5 text-sm font-semibold text-white bg-emerald-500 hover:bg-emerald-600 rounded-xl disabled:opacity-50 flex items-center justify-center gap-2 transition-colors">
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          {saving ? 'Saving...' : 'Save Address'}
        </button>
      </div>
    </div>
  );
}

function Field({ label, required = false, value, onChange, placeholder, autoFocus = false, forceAutoFocus = false, inputMode }: {
  label: string;
  required?: boolean;
  value: string;
  onChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
  placeholder: string;
  autoFocus?: boolean;
  forceAutoFocus?: boolean;
  inputMode?: 'numeric';
}) {
  const finePointer = useFinePointer();
  return (
    <div>
      <label className="block text-[10px] font-medium text-gray-500 mb-1">
        {label}{required && <span className="ml-0.5 font-bold text-red-500" aria-hidden="true">*</span>}
      </label>
      <input type="text" inputMode={inputMode} maxLength={inputMode === 'numeric' ? 6 : undefined} value={value} onChange={onChange}
        className={`${inputClass} scroll-mb-28`} placeholder={placeholder} autoFocus={autoFocus && (finePointer || forceAutoFocus)} aria-required={required} />
    </div>
  );
}