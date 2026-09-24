import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface ThemeState {
  isDark: boolean;
  toggle: () => void;
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set) => ({
      isDark: false,
      toggle: () => set(s => ({ isDark: !s.isDark })),
    }),
    { name: 'mart-admin-theme' }
  )
);

// Apply the persisted preference before React mounts so the mobile shell does
// not briefly render in light mode on a dark-mode launch.
const stored = localStorage.getItem('mart-admin-theme');
if (stored) {
  try {
    const { state } = JSON.parse(stored);
    document.documentElement.classList.toggle('dark', state?.isDark === true);
  } catch {
    document.documentElement.classList.remove('dark');
  }
} else {
  document.documentElement.classList.remove('dark');
}
