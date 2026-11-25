import { Capacitor } from '@capacitor/core';
import { StatusBar, Style } from '@capacitor/status-bar';

export function isNativeAndroid(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';
}

export async function configureNativeChrome(): Promise<void> {
  if (!isNativeAndroid()) return;
  const dark = document.documentElement.classList.contains('dark');
  try { await StatusBar.setOverlaysWebView({ overlay: false }); } catch {}
  try { await StatusBar.setBackgroundColor({ color: dark ? '#18191a' : '#FEB503' }); } catch {}
  try { await StatusBar.setStyle({ style: dark ? Style.Dark : Style.Light }); } catch {}
}

export async function setNativeStatusBar(color: string, darkIcons: boolean): Promise<void> {
  if (!isNativeAndroid()) return;
  try { await StatusBar.setOverlaysWebView({ overlay: false }); } catch {}
  try { await StatusBar.setBackgroundColor({ color }); } catch {}
  try { await StatusBar.setStyle({ style: darkIcons ? Style.Light : Style.Dark }); } catch {}
}
