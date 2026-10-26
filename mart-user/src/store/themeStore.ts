import { create } from 'zustand';
import { persist } from 'zustand/middleware';

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

// Apply the persisted class before React renders. The system bar is deliberately
// left on the shared splash green until the splash is dismissed.
const stored = localStorage.getItem('mart-theme');
if (stored) {
  try {
    const { state } = JSON.parse(stored);
    const isDark = state?.isDark === true;
    document.documentElement.classList.toggle('dark', isDark);
  } catch { document.documentElement.classList.remove('dark'); }
} else {
  document.documentElement.classList.remove('dark');
}
