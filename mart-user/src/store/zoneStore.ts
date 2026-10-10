import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { MartZone } from '../services/api';
import { storeApi } from '../services/api';
import { getUserLocation, findMatchingZone } from '../services/geofence';

// Offline fallback that mirrors the DB-seeded Shapoorji store:
//   - name / lat / lng / radiusKm match migration 005_delivery_zones.sql
//   - storeId matches the seeded store UUID in migration 010_multi_store.sql
//        "00000000-0000-0000-0000-000000000001"
// It is ONLY a last-resort default for the brief startup window and for when
// GET /zones is unreachable. The live source of truth is the `mart_zones`
// table exposed by GET /zones (created/edited by the super admin) — the app
// always prefers those zones over this constant.
export const SHAPOORJI_ZONE: MartZone = {
  id: 'shapoorji-default',
  storeId: '00000000-0000-0000-0000-000000000001',
  name: 'Shapoorji',
  lat: 22.565717182227967,
  lng: 88.51426843552692,
  radiusKm: 5,
  isActive: true,
};

// Outcome of a location lookup. `zone` is always the caller's current selection
// so UI can keep a stable label. A failed lookup is never a block — the
// customer can still pick any delivery area manually.
export type ZoneAction =
  | { status: 'applied'; zone: MartZone }
  | { status: 'kept'; zone: MartZone }
  | { status: 'no_match'; zone: MartZone | null }
  | { status: 'denied'; zone: MartZone | null }
  | { status: 'unavailable'; zone: MartZone | null }
  | { status: 'error'; zone: MartZone | null }
  | { status: 'busy'; zone: MartZone | null };

type ZoneUpdate = MartZone | null | ((prev: MartZone | null) => MartZone | null);

interface ZoneState {
  zones: MartZone[];
  selectedZone: MartZone | null;
  // Whether the customer has a zone in effect — chosen via the dropdown, set by
  // a location lookup, or restored from a previous session. While false the app
  // may quietly prefill the zone from GPS on a first visit; once true it never
  // overrides the customer's area from GPS again (covering "order for family in
  // a chosen area while the phone is far away").
  zoneSelected: boolean;
  // Whether the app should quietly prefill the delivery area from GPS.
  autoDetect: boolean;
  locating: boolean;
  setZones: (zones: MartZone[]) => void;
  setSelectedZone: (zone: ZoneUpdate) => void;
  // User-initiated pick (navbar dropdown). Deliberate, so it locks the area.
  chooseZone: (zone: MartZone) => void;
  setAutoDetect: (enabled: boolean) => void;
  setLocating: (locating: boolean) => void;
  detectAndApply: () => Promise<ZoneAction>;
}

export const useZoneStore = create<ZoneState>()(
  persist(
    (set, get) => ({
      zones: [],
      selectedZone: SHAPOORJI_ZONE,
      zoneSelected: false,
      autoDetect: localStorage.getItem('mart_location_enabled') !== 'false',
      locating: false,
      setZones: zones => set({ zones }),
      setSelectedZone: zone => set(state => ({
        selectedZone: typeof zone === 'function' ? zone(state.selectedZone) : zone,
      })),
      chooseZone: zone => set({ selectedZone: zone, zoneSelected: true }),
      setAutoDetect: enabled => set({ autoDetect: enabled }),
      setLocating: locating => set({ locating }),
      detectAndApply: async () => {
        const { locating, selectedZone } = get();
        if (locating) return { status: 'busy', zone: selectedZone };
        set({ locating: true });
        try {
          const location = await getUserLocation();
          const current = get().selectedZone;
          if (location.status === 'denied') {
            // Explicit opt-out — remember it so the quiet load-time lookup stays off.
            set({ autoDetect: false });
            return { status: 'denied', zone: current };
          }
          if (location.status !== 'granted') {
            // Timeout / no fix / unsupported — NOT a refusal, so don't flip the preference.
            return { status: 'unavailable', zone: current };
          }
          // A successful fix means detection works, so the preference stays on.
          set({ autoDetect: true });
          let availableZones = get().zones;
          if (availableZones.length === 0) {
            try {
              const res = await storeApi.getZones();
              availableZones = res.data.data || [];
              if (availableZones.length > 0) set({ zones: availableZones });
            } catch {
              return { status: 'error', zone: current };
            }
          }
          const match = findMatchingZone(location.lat, location.lng, availableZones);
          if (!match) {
            // GPS found nothing to match. This is not a block: the customer can
            // still pick an area manually (e.g. ordering for family in a chosen
            // zone while being far away).
            return { status: 'no_match', zone: current };
          }
          if (current?.storeId === match.zone.storeId) {
            // Already delivering there — treat it as settled so a later visit
            // won't re-probe GPS and switch the customer away.
            set({ zoneSelected: true });
            return { status: 'kept', zone: match.zone };
          }
          set({ selectedZone: match.zone, zoneSelected: true });
          return { status: 'applied', zone: match.zone };
        } finally {
          set({ locating: false });
        }
      },
    }),
    {
      name: 'mart-zone',
      // Remember only the customer's delivery-area choice and detection
      // preference across sessions — not transient lookup state.
      partialize: state => ({
        selectedZone: state.selectedZone,
        zoneSelected: state.zoneSelected,
        autoDetect: state.autoDetect,
      }),
      // Older persisted sessions have `selectedZone` but no `zoneSelected`.
      // Derive it from a saved non-default zone so those customers keep their
      // area without a surprise GPS re-detect on their next visit.
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<ZoneState>;
        const zoneSelected = p.zoneSelected ?? (p.selectedZone ? p.selectedZone.id !== SHAPOORJI_ZONE.id : false);
        return { ...current, ...p, zoneSelected };
      },
    }
  )
);