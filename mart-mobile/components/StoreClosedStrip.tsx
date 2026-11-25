import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { storeApi, type PublicSettings } from '@/services/api';
import { useZoneStore } from '@/store/zoneStore';
import { useThemeColors } from '@/constants/theme';
import {
  defaultClosedHeading,
  formatClosedMessage,
  isStoreClosed,
  readClosedCopy,
  rememberClosedCopy,
  reopenLine,
} from '@/utils/storeClosed';

interface Props {
  settings?: PublicSettings | null;
}

export default function StoreClosedStrip({ settings: supplied }: Props) {
  const colors = useThemeColors();
  const selectedZone = useZoneStore(state => state.selectedZone);
  const storeId = selectedZone?.storeId;
  const zoneId = selectedZone?.id;
  const [fetched, setFetched] = useState<PublicSettings | null>(null);
  const lastRefresh = useRef(0);
  const settings = supplied !== undefined ? supplied : fetched;

  const load = useCallback(async () => {
    try {
      const response = await storeApi.getSettings(storeId, zoneId);
      const next = response.data.data ?? null;
      setFetched(next);
      rememberClosedCopy(next?.store_closed_greeting, next?.store_closed_message);
    } catch {
      const cached = readClosedCopy();
      if (cached) setFetched(current => current ?? ({ store_closed_greeting: cached.greeting, store_closed_message: cached.message } as PublicSettings));
    }
  }, [storeId, zoneId]);

  useEffect(() => {
    if (supplied !== undefined) return;
    void load();
  }, [load, supplied]);

  useEffect(() => {
    if (supplied !== undefined) return;
    const refresh = (force = false) => {
      const now = Date.now();
      if (!force && now - lastRefresh.current < 15_000) return;
      lastRefresh.current = now;
      void load();
    };
    const subscription = AppState.addEventListener('change', state => {
      if (state === 'active') refresh();
    });
    const interval = setInterval(() => refresh(), 3 * 60 * 1000);
    return () => {
      subscription.remove();
      clearInterval(interval);
    };
  }, [load, supplied]);

  const nextOpenAt = settings?.openState?.isOpen === false ? settings.openState.nextOpenAt : null;
  useEffect(() => {
    if (supplied !== undefined || !nextOpenAt) return;
    const delay = Date.parse(nextOpenAt) - Date.now();
    if (!Number.isFinite(delay) || delay <= 0 || delay > 24 * 60 * 60 * 1000) return;
    const timer = setTimeout(() => { void load(); }, delay);
    return () => clearTimeout(timer);
  }, [load, nextOpenAt, supplied]);

  if (!isStoreClosed(settings)) return null;

  const cached = readClosedCopy();
  const resume = settings?.openState?.closedUntilLabel ?? settings?.openState?.nextOpenLabel ?? null;
  const greeting = settings?.store_closed_greeting?.trim() || cached?.greeting || defaultClosedHeading();
  const authored = settings?.store_closed_message?.trim() || cached?.message || '';
  const message = authored ? formatClosedMessage(authored, { until: resume || 'later' }) : '';
  const reassurance = reopenLine(resume);

  return (
    <View style={{ backgroundColor: colors.bgTint, borderBottomWidth: 1, borderBottomColor: colors.gray200, paddingHorizontal: 16, paddingVertical: 9 }}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8 }}>
        <Ionicons name="time-outline" size={16} color={colors.gray600} style={{ marginTop: 1 }} />
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 11, fontFamily: 'Inter-Bold', color: colors.gray900 }}>{greeting}</Text>
          {message ? (
            <Text style={{ fontSize: 11, fontFamily: 'Inter-Medium', color: colors.gray700, marginTop: 2 }}>{message}</Text>
          ) : null}
          <Text style={{ fontSize: 11, fontFamily: 'Inter-Medium', color: colors.gray600, marginTop: 2 }}>{reassurance}</Text>
        </View>
      </View>
    </View>
  );
}
