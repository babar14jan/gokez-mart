import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { MartZone } from '@/services/api';

export type ZoneStatus =
  | 'idle'
  | 'locating'
  | 'applied'
  | 'kept'
  | 'no_match'
  | 'denied'
  | 'unavailable'
  | 'error';

interface ZoneState {
  zones: MartZone[];
  selectedZone: MartZone | null;
  gpsConfirmed: boolean;
  zoneSelected: boolean;
  autoDetect: boolean;
  status: ZoneStatus;
  setZones: (zones: MartZone[]) => void;
  setSelectedZone: (zone: MartZone, gpsConfirmed?: boolean) => void;
  chooseZone: (zone: MartZone) => void;
  setZoneSelected: (selected: boolean) => void;
  setAutoDetect: (enabled: boolean) => void;
  setStatus: (status: ZoneStatus) => void;
  clearZone: () => void;
}

export const useZoneStore = create<ZoneState>()(
  persist(
    set => ({
      zones:        [],
      selectedZone: null,
      gpsConfirmed: false,
      zoneSelected: false,
      autoDetect:   true,
      status:       'idle',
      setZones: zones => set({ zones }),
      setSelectedZone: (zone, gpsConfirmed = false) => set({
        selectedZone: zone,
        gpsConfirmed,
        zoneSelected: true,
        status: gpsConfirmed ? 'applied' : 'kept',
      }),
      chooseZone: zone => set({ selectedZone: zone, gpsConfirmed: false, zoneSelected: true, status: 'applied' }),
      setZoneSelected: (zoneSelected: boolean) => set({ zoneSelected }),
      setAutoDetect: (autoDetect: boolean) => set({ autoDetect }),
      setStatus: (status: ZoneStatus) => set({ status }),
      clearZone: () => set({ selectedZone: null, gpsConfirmed: false, zoneSelected: false, status: 'idle' }),
    }),
    {
      name: 'mart-zone',
      storage: createJSONStorage(() => AsyncStorage),
      version: 1,
      migrate: persistedState => {
        const state = persistedState as Partial<ZoneState> | undefined;
        if (!state || typeof state !== 'object') return {} as ZoneState;
        return {
          ...state,
          zoneSelected: typeof state.zoneSelected === 'boolean' ? state.zoneSelected : Boolean(state.selectedZone),
          autoDetect: typeof state.autoDetect === 'boolean' ? state.autoDetect : true,
        } as ZoneState;
      },
    }
  )
);
