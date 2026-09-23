/** Display-only GPS cleanup. Raw, audited samples remain unchanged in storage. */
export type RecordedPoint = {
  session_id: string;
  latitude: number;
  longitude: number;
  captured_at: string;
  accuracy_m: number;
  mock_location: boolean;
};

const MAX_JOIN_GAP_MS = 5 * 60_000;
// A 100 m fix can place someone across a street indoors. It must not draw a travel route.
const MAX_ROUTE_ACCURACY_M = 30;
export const MAX_POSITION_ACCURACY_M = 100;
const MAX_PLAUSIBLE_SPEED_M_S = 55;

function metres(a: RecordedPoint, b: RecordedPoint) {
  const lat = (b.latitude - a.latitude) * Math.PI / 180;
  const lon = (b.longitude - a.longitude) * Math.PI / 180;
  const middle = (a.latitude + b.latitude) * Math.PI / 360;
  const sine = Math.sin(lat / 2) ** 2 + Math.cos(middle) ** 2 * Math.sin(lon / 2) ** 2;
  return 12_742_000 * Math.atan2(Math.sqrt(sine), Math.sqrt(1 - sine));
}

function sameContinuousSession(a: RecordedPoint, b: RecordedPoint) {
  const elapsed = Date.parse(b.captured_at) - Date.parse(a.captured_at);
  return a.session_id === b.session_id && elapsed > 0 && elapsed <= MAX_JOIN_GAP_MS;
}

export function reliablePosition(point: Pick<RecordedPoint, 'latitude' | 'longitude' | 'accuracy_m' | 'mock_location'>) {
  return !point.mock_location && Number.isFinite(point.latitude) && Number.isFinite(point.longitude)
    && Number.isFinite(point.accuracy_m) && point.accuracy_m >= 0 && point.accuracy_m <= MAX_POSITION_ACCURACY_M;
}

/** A location fix is a measured area, never proof of a particular building. */
export function accuracyRing(longitude: number, latitude: number, radiusMetres: number): number[][] {
  const latDegrees = radiusMetres / 111_320;
  const lonDegrees = radiusMetres / (111_320 * Math.max(0.01, Math.cos(latitude * Math.PI / 180)));
  const ring = Array.from({ length: 32 }, (_, index) => {
    const angle = index * 2 * Math.PI / 32;
    return [longitude + lonDegrees * Math.cos(angle), latitude + latDegrees * Math.sin(angle)];
  });
  return [...ring, [...ring[0]!]];
}

export function displayRoute(points: RecordedPoint[]) {
  const lines: number[][][] = [];
  const plotted: RecordedPoint[] = [];
  let line: number[][] = [];
  let anchor: RecordedPoint | null = null;
  let pending: RecordedPoint | null = null;
  let previousRaw: RecordedPoint | null = null;
  const flush = () => { if (line.length > 1) lines.push(line); line = []; };
  for (const point of points) {
    if (!reliablePosition(point) || point.accuracy_m > MAX_ROUTE_ACCURACY_M) {
      flush(); anchor = null; pending = null; previousRaw = null;
      continue;
    }
    if (!anchor || !previousRaw || !sameContinuousSession(previousRaw, point)) {
      flush(); anchor = point; pending = null; previousRaw = point;
      line = [[point.longitude, point.latitude]];
      plotted.push(point);
      continue;
    }
    previousRaw = point;
    const elapsedSeconds = (Date.parse(point.captured_at) - Date.parse(anchor.captured_at)) / 1000;
    const minimumTravel = Math.max(0, metres(anchor, point) - anchor.accuracy_m - point.accuracy_m);
    if (minimumTravel / elapsedSeconds > MAX_PLAUSIBLE_SPEED_M_S) { pending = null; continue; }
    // Movement smaller than the two uncertainty radii is indistinguishable from stationary drift.
    if (metres(anchor, point) <= anchor.accuracy_m + point.accuracy_m) { pending = null; continue; }
    // One displaced fix is not a trip. Require another fix near it and still outside the anchor's uncertainty.
    if (pending && sameContinuousSession(pending, point)
      && metres(pending, point) <= pending.accuracy_m + point.accuracy_m) {
      line.push([point.longitude, point.latitude]);
      plotted.push(point);
      anchor = point;
      pending = null;
    } else {
      pending = point;
    }
  }
  flush();
  return { lines, plotted, omitted: points.length - plotted.length };
}
