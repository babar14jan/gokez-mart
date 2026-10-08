import { useState } from 'react';
import { useFinePointer } from '../utils/useFinePointer';
import { authApi } from '../services/api';
import { useCustomerAuthStore } from '../store/customerAuthStore';
import { useCustomerStore } from '../store/customerStore';
import { Loader2 } from 'lucide-react';

interface NamePromptProps {
  onDone: () => void;
}

export default function NamePrompt({ onDone }: NamePromptProps) {
  const finePointer = useFinePointer();
  const { updateProfile } = useCustomerAuthStore();
  const { setName: syncName } = useCustomerStore();
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSave = async () => {
    if (saving) return;
    const trimmed = name.trim().replace(/\s+/g, ' ');
    if (!trimmed) { onDone(); return; }
    if (trimmed.length < 2 || trimmed.length > 80 || !/\p{L}/u.test(trimmed)) {
      setError('Enter a name between 2 and 80 characters.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      await authApi.updateProfile({ name: trimmed });
      updateProfile({ name: trimmed });
      syncName(trimmed);
      onDone();
    } catch (requestError: any) {
      setError(requestError?.response?.data?.error || 'We could not save your name. Please try again.');
    } finally { setSaving(false); }
  };

  const handleSkip = () => {
    // Don't save a fake name — just skip, name stays null
    sessionStorage.setItem('mart_name_prompt_skipped', '1');
    onDone();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-900/60 backdrop-blur-sm">
      <div className="bg-white dark:bg-slate-800 w-full sm:max-w-sm rounded-t-3xl sm:rounded-2xl shadow-2xl p-6">

        {/* Handle */}
        <div className="sm:hidden flex justify-center mb-4">
          <div className="w-10 h-1 bg-gray-200 rounded-full" />
        </div>

        <h2 className="text-base font-bold text-gray-900 dark:text-white mb-1 text-center">
          What should we call you? 👋
        </h2>
        <p className="text-sm text-gray-500 dark:text-slate-400 text-center mb-5">
          Helps us personalise your experience
        </p>

        <input
          autoFocus={finePointer}
          type="text"
          value={name}
          onChange={e => { setName(e.target.value); setError(''); }}
          onKeyDown={e => e.key === 'Enter' && handleSave()}
          placeholder="Your name"
          aria-invalid={Boolean(error)}
          className="w-full px-4 py-3 border border-gray-200 dark:border-slate-600 rounded-2xl text-sm text-gray-900 dark:text-white bg-gray-50 dark:bg-slate-700 focus:bg-white dark:focus:bg-slate-600 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all placeholder:text-gray-500 mb-3"
        />

        {error && <p className="-mt-1 mb-3 text-xs font-medium text-red-600 dark:text-red-400">{error}</p>}

        <button
          onClick={handleSave}
          disabled={saving}
          className="w-full flex items-center justify-center gap-2 py-3 bg-emerald-500 hover:bg-emerald-600 text-white text-sm font-bold rounded-2xl disabled:opacity-50 transition-all mb-2"
        >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Save name'}
        </button>

        <button
          onClick={handleSkip}
          className="w-full py-2 text-xs text-gray-500 hover:text-gray-600 transition-colors"
        >
          Skip for now
        </button>
      </div>
    </div>
  );
}
