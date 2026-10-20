import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { detectPlatform } from '../utils/install';

// iOS <=18 still reads theme-color for the Safari status bar. Android paints its
// address bar from it too. iOS 26 dropped support entirely (it samples the page
// edges instead — the header itself for the top edge, .app-tint-bottom for the
// bottom, see index.css), but the tag is harmless there. Keep the top edge green
// on iOS and Android so the system status/address bar matches the app header;
// desktop stays white.
function lightThemeColor(): string {
  const p = detectPlatform();
  return p === 'ios' || p === 'android' ? '#218044' : '#ffffff';
}

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
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', isDark ? '#18191a' : lightThemeColor());
  } catch { document.documentElement.classList.remove('dark'); }
} else {
  document.documentElement.classList.remove('dark');
}
