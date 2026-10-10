import type { MartZone } from './api';

export function haversineDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat/2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng/2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

export interface ZoneMatch {
  zone: MartZone;
  distanceKm: number;
}

// Find which zone the coordinates fall into (nearest within radius)
export function findMatchingZone(lat: number, lng: number, zones: MartZone[]): ZoneMatch | null {
  let best: ZoneMatch | null = null;
  for (const zone of zones) {
    const dist = haversineDistance(lat, lng, zone.lat, zone.lng);
    if (dist <= zone.radiusKm) {
      if (!best || dist < best.distanceKm) {
        best = { zone, distanceKm: Math.round(dist * 10) / 10 };
      }
    }
  }
  return best;
}

// Outcome of a geolocation request. `denied` means the customer blocked the
// browser permission (an explicit opt-out we should remember); `unavailable`
// covers timeout / no fix / unsupported, which must NOT be treated as a refusal.
export type LocationResult =
  | { status: 'granted'; lat: number; lng: number }
  | { status: 'denied' }
  | { status: 'unavailable' };

// Get user's current GPS coordinates
export async function getUserLocation(): Promise<LocationResult> {
  if (!navigator.geolocation) return { status: 'unavailable' };
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ status: 'granted', lat: pos.coords.latitude, lng: pos.coords.longitude }),
      (err) => resolve({ status: err.code === err.PERMISSION_DENIED ? 'denied' : 'unavailable' }),
      { timeout: 8000, maximumAge: 300000 }
    );
  });
}
