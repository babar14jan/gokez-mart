import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { MartZone } from '@/services/api';

interface ZoneState {
  zones: MartZone[];
  selectedZone: MartZone | null;
  gpsConfirmed: boolean;
  setZones: (zones: MartZone[]) => void;
  setSelectedZone: (zone: MartZone, gpsConfirmed?: boolean) => void;
}

export const useZoneStore = create<ZoneState>()(
  persist(
    set => ({
      zones:        [],
      selectedZone: null,
      gpsConfirmed: false,
      setZones: zones => set({ zones }),
      setSelectedZone: (zone, gpsConfirmed = false) => set({ selectedZone: zone, gpsConfirmed }),
    }),
    { name: 'mart-zone', storage: createJSONStorage(() => AsyncStorage) }
  )
);
