import { useState } from 'react';
import { authApi } from '../services/api';
import { useCustomerAuthStore } from '../store/customerAuthStore';
import { useCustomerStore } from '../store/customerStore';
import { Loader2 } from 'lucide-react';

interface NamePromptProps {
  onDone: () => void;
}

export default function NamePrompt({ onDone }: NamePromptProps) {
  const { updateProfile } = useCustomerAuthStore();
  const { setName: syncName } = useCustomerStore();
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    const trimmed = name.trim();
    if (!trimmed) { onDone(); return; }
    setSaving(true);
    try {
      await authApi.updateProfile({ name: trimmed });
      updateProfile({ name: trimmed });
      syncName(trimmed);
    } catch {}
    finally { setSaving(false); onDone(); }
  };

  const handleSkip = () => {
    // Don't save a fake name — just skip, name stays null
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
        <p className="text-sm text-gray-400 dark:text-slate-500 text-center mb-5">
          Helps us personalise your experience
        </p>

        <input
          autoFocus
          type="text"
          value={name}
          onChange={e => setName(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleSave()}
          placeholder="Your name"
          className="w-full px-4 py-3 border border-gray-200 dark:border-slate-600 rounded-2xl text-sm text-gray-900 dark:text-white bg-gray-50 dark:bg-slate-700 focus:bg-white dark:focus:bg-slate-600 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all placeholder:text-gray-400 mb-3"
        />

        <button
          onClick={handleSave}
          disabled={saving}
          className="w-full flex items-center justify-center gap-2 py-3 bg-emerald-500 hover:bg-emerald-600 text-white text-sm font-bold rounded-2xl disabled:opacity-50 transition-all mb-2"
        >
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Continue'}
        </button>

        <button
          onClick={handleSkip}
          className="w-full py-2 text-xs text-gray-400 hover:text-gray-600 transition-colors"
        >
          Skip for now
        </button>
      </div>
    </div>
  );
}
