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

// Apply on load — default light unless user explicitly chose dark
const stored = localStorage.getItem('mart-theme');
if (stored) {
  try {
    const { state } = JSON.parse(stored);
    document.documentElement.classList.toggle('dark', state?.isDark === true);
  } catch { document.documentElement.classList.remove('dark'); }
} else {
  document.documentElement.classList.remove('dark');
}
