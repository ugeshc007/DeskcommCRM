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
const MAX_DISPLAY_ACCURACY_M = 100;
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

function bounced(a: RecordedPoint, b: RecordedPoint, c: RecordedPoint) {
  if (!sameContinuousSession(a, b) || !sameContinuousSession(b, c)) return false;
  if (Date.parse(c.captured_at) - Date.parse(a.captured_at) > 120_000) return false;
  const returnRadius = Math.max(30, a.accuracy_m + c.accuracy_m);
  const excursion = Math.max(80, 2 * (a.accuracy_m + b.accuracy_m + c.accuracy_m));
  return metres(a, c) <= returnRadius && metres(a, b) > excursion && metres(b, c) > excursion;
}

export function displayRoute(points: RecordedPoint[]) {
  const good = points.filter(p => !p.mock_location && Number.isFinite(p.latitude) && Number.isFinite(p.longitude)
    && Number.isFinite(p.accuracy_m) && p.accuracy_m >= 0 && p.accuracy_m <= MAX_DISPLAY_ACCURACY_M);
  const goodSet = new Set(good);
  const bouncedPoints = new Set<RecordedPoint>();
  for (let i = 1; i < good.length - 1; i++) {
    if (bounced(good[i - 1]!, good[i]!, good[i + 1]!)) bouncedPoints.add(good[i]!);
  }
  const lines: number[][][] = [];
  const plotted: RecordedPoint[] = [];
  let line: number[][] = [];
  let previous: RecordedPoint | null = null;
  const flush = () => { if (line.length > 1) lines.push(line); line = []; };
  for (const point of points) {
    if (!goodSet.has(point) || bouncedPoints.has(point)) {
      if (!bouncedPoints.has(point)) { flush(); previous = null; }
      continue;
    }
    if (previous && !sameContinuousSession(previous, point)) { flush(); previous = null; }
    if (previous) {
      const elapsedSeconds = (Date.parse(point.captured_at) - Date.parse(previous.captured_at)) / 1000;
      const minimumTravel = Math.max(0, metres(previous, point) - previous.accuracy_m - point.accuracy_m);
      if (minimumTravel / elapsedSeconds > MAX_PLAUSIBLE_SPEED_M_S) { flush(); previous = null; continue; }
    }
    line.push([point.longitude, point.latitude]);
    plotted.push(point);
    previous = point;
  }
  flush();
  return { lines, plotted, omitted: points.length - plotted.length };
}
