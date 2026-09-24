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

// Apply the persisted color before React renders so installed PWAs do not flash
// a light or navy status area when reopening in dark mode.
const stored = localStorage.getItem('mart-theme');
if (stored) {
  try {
    const { state } = JSON.parse(stored);
    const isDark = state?.isDark === true;
    document.documentElement.classList.toggle('dark', isDark);
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', isDark ? '#18191a' : '#0f172a');
  } catch { document.documentElement.classList.remove('dark'); }
} else {
  document.documentElement.classList.remove('dark');
}
