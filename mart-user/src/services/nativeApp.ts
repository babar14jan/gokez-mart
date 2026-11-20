import { Capacitor } from '@capacitor/core';
import { App as CapacitorApp } from '@capacitor/app';
import { Geolocation } from '@capacitor/geolocation';
import { StatusBar, Style } from '@capacitor/status-bar';

export function isNativeAndroid(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';
}

export async function configureNativeChrome(): Promise<void> {
  if (!isNativeAndroid()) return;
  try { await StatusBar.setOverlaysWebView({ overlay: false }); } catch {}
  try { await StatusBar.setBackgroundColor({ color: '#087A43' }); } catch {}
  try { await StatusBar.setStyle({ style: Style.Light }); } catch {}
}

export async function setNativeStatusBar(color: string, darkText: boolean): Promise<void> {
  if (!isNativeAndroid()) return;
  try { await StatusBar.setBackgroundColor({ color }); } catch {}
  try { await StatusBar.setStyle({ style: darkText ? Style.Light : Style.Dark }); } catch {}
}

export async function hasNativeLocationPermission(): Promise<boolean> {
  if (!isNativeAndroid()) return true;
  try {
    const current = await Geolocation.checkPermissions();
    return current.location === 'granted' || current.coarseLocation === 'granted';
  } catch { return false; }
}

export async function ensureLocationPermission(): Promise<boolean> {
  if (!isNativeAndroid()) return true;
  try {
    const current = await Geolocation.checkPermissions();
    if (current.location === 'granted' || current.coarseLocation === 'granted') return true;
    const next = await Geolocation.requestPermissions();
    return next.location === 'granted' || next.coarseLocation === 'granted';
  } catch {
    return true;
  }
}

export async function watchNativeBackButton(onBack: () => boolean): Promise<() => void> {
  if (!isNativeAndroid()) return () => {};
  const handle = await CapacitorApp.addListener('backButton', () => {
    if (!onBack()) {
      CapacitorApp.exitApp().catch(() => {});
    }
  });
  return () => {
    handle.remove().catch(() => {});
  };
}
