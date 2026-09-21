import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

interface ThemeState {
  isDark: boolean;
  toggle: () => void;
}

export const useThemeStore = create<ThemeState>()(
  persist(
    set => ({
      isDark: false,
      toggle: () => set(s => ({ isDark: !s.isDark })),
    }),
    { name: 'mart-theme', storage: createJSONStorage(() => AsyncStorage) }
  )
);
