import { useThemeStore } from '@/store/themeStore';

export const colors = {
  primary:      '#10b981',
  primaryDark:  '#065f46',
  primaryLight: '#d1fae5',
  yellow:       '#FED102',
  amber:        '#E8960A',
  bg:           '#f9fafb',
  bgTint:       '#f0fdf4',
  surface:      '#ffffff',
  bgLight:      '#f0fdf4',
  bgDark:       '#18191a',
  cardDark:     '#242526',
  white:        '#ffffff',
  black:        '#111827',
  gray50:       '#f9fafb',
  gray100:      '#f3f4f6',
  gray200:      '#e5e7eb',
  gray300:      '#d1d5db',
  gray400:      '#9ca3af',
  gray500:      '#6b7280',
  gray600:      '#4b5563',
  gray700:      '#374151',
  gray800:      '#1f2937',
  gray900:      '#111827',
  red500:       '#ef4444',
  green500:     '#22c55e',
  redLight:     '#fef2f2',
};

export const darkColors: typeof colors = {
  primary:      '#10b981',
  primaryDark:  '#a7f3d0',
  primaryLight: '#0f2e22',
  yellow:       '#FED102',
  amber:        '#E8960A',
  bg:           '#18191a',
  bgTint:       '#10201a',
  surface:      '#242526',
  bgLight:      '#10201a',
  bgDark:       '#18191a',
  cardDark:     '#242526',
  white:        '#ffffff',
  black:        '#111827',
  gray50:       '#1f2937',
  gray100:      '#27292b',
  gray200:      '#374151',
  gray300:      '#4b5563',
  gray400:      '#6b7280',
  gray500:      '#9ca3af',
  gray600:      '#d1d5db',
  gray700:      '#e5e7eb',
  gray800:      '#f3f4f6',
  gray900:      '#f9fafb',
  red500:       '#f87171',
  green500:     '#4ade80',
  redLight:     '#3f1d1d',
};

// Reactive palette — use inside components so colors update instantly on theme toggle.
export function useThemeColors() {
  const isDark = useThemeStore(s => s.isDark);
  return isDark ? darkColors : colors;
}

export const spacing = {
  xs:  4,
  sm:  8,
  md:  12,
  lg:  16,
  xl:  20,
  '2xl': 24,
  '3xl': 32,
  '4xl': 48,
};

export const radius = {
  sm:   8,
  md:   12,
  lg:   16,
  xl:   20,
  '2xl': 24,
  full: 9999,
};

export const fontSize = {
  xs:   12,
  sm:   14,
  base: 16,
  lg:   18,
  xl:   20,
  '2xl': 24,
  '3xl': 30,
};

export const fontWeight = {
  regular:  '400' as const,
  medium:   '500' as const,
  semibold: '600' as const,
  bold:     '700' as const,
};
