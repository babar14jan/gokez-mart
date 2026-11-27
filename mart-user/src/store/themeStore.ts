import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { isEffectiveAlwaysLightRoute } from '../constants/brand';

interface ThemeState {
  isDark: boolean;
  toggle: () => void;
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set, get) => ({
      isDark: false,
      toggle: () => {
        const next = !get().isDark;
        set({ isDark: next });
      },
    }),
    { name: 'mart-theme' }
  )
);

// Apply the persisted class before React renders, except on the always-light
// onboarding/login routes. The system bar stays on the shared splash green there.
const stored = localStorage.getItem('mart-theme');
if (isEffectiveAlwaysLightRoute()) {
  document.documentElement.classList.remove('dark');
} else if (stored) {
  try {
    const { state } = JSON.parse(stored);
    const isDark = state?.isDark === true;
    document.documentElement.classList.toggle('dark', isDark);
  } catch { document.documentElement.classList.remove('dark'); }
} else {
  document.documentElement.classList.remove('dark');
}
