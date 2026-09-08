import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface ThemeState {
  isDark: boolean;
  toggle: () => void;
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set, get) => ({
      isDark: true,
      toggle: () => {
        const next = !get().isDark;
        set({ isDark: next });
      },
    }),
    { name: 'mart-theme' }
  )
);

// Apply on load — default dark unless user explicitly chose light
const stored = localStorage.getItem('mart-theme');
if (stored) {
  try {
    const { state } = JSON.parse(stored);
    document.documentElement.classList.toggle('dark', state?.isDark !== false);
  } catch { document.documentElement.classList.add('dark'); }
} else {
  document.documentElement.classList.add('dark');
}
