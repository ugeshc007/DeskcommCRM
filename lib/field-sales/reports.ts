import { addCalendarDays, wallTimeToUtc } from './schedule';
import { localDateSchema } from './contracts';
import { googleMapsPointUrl } from './map-links';

type Instant = string | Date;
type ReportSession = { display_name: string; punched_in_at: Instant; punched_out_at: Instant | null;
  corrected_in: Instant | null; corrected_out: Instant | null };
type ReportVisit = { display_name: string; project_name: string; local_date: string | Date; status: string };
const epoch = (value: Instant) => new Date(value).getTime();
/** Explicit projection: no coordinates, notes, phone numbers, bearer keys or employee IDs. */
export function dailyFieldReport(date: string, timezone: string, sessions: ReportSession[], visits: ReportVisit[]) {
  localDateSchema.parse(date);
  const start = Date.parse(wallTimeToUtc(date, '00:00', timezone));
  const end = Date.parse(wallTimeToUtc(addCalendarDays(date, 1), '00:00', timezone));
  const span = (from: Instant, through: Instant | null) => through === null ? ''
    : String(Math.round(Math.max(0, Math.min(epoch(through), end) - Math.max(epoch(from), start)) / 60000));
  const rows: string[][] = [['Date', 'Time zone', 'Record', 'Employee', 'Project', 'Status', 'Original span minutes including breaks', 'Approved span minutes including breaks']];
  for (const session of sessions) rows.push([date, timezone, 'Attendance', session.display_name, '',
    session.punched_out_at ? 'Closed' : 'Open - duration not finalized', span(session.punched_in_at, session.punched_out_at),
    session.corrected_in && session.corrected_out ? span(session.corrected_in, session.corrected_out) : '']);
  for (const visit of visits) {
    const local = visit.local_date instanceof Date ? visit.local_date.toISOString().slice(0, 10) : visit.local_date.slice(0, 10);
    if (local === date) rows.push([date, timezone, 'Visit', visit.display_name, visit.project_name, visit.status, '', '']);
  }
  return '\uFEFF' + rows.map(row => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}
type LocationPoint = { captured_at: Instant; latitude: number | string; longitude: number | string;
  accuracy_m: number | string; mock_location: boolean; quality_flags?: string[] | null };
type AreaChange = { point: LocationPoint; label: string | null };
/** The first reliable fix near each consecutive mapped area; unmapped fixes stay visible. */
export function locationAreaChanges(points: LocationPoint[], nearbyLabels: Array<string | null>): AreaChange[] {
  if (points.length !== nearbyLabels.length) throw new Error('Location labels do not match recorded fixes');
  const changes: AreaChange[] = [];
  let previousArea: string | null = null;
  for (const [index, point] of points.entries()) {
    const label = nearbyLabels[index]?.trim() || null;
    // A city label covers too much ground to imply that repeated fixes are stationary.
    if (!label || !label.endsWith('(area)')) { changes.push({ point, label }); continue; }
    const area = label.toLocaleLowerCase('en');
    if (area === previousArea) continue;
    changes.push({ point, label });
    previousArea = area;
  }
  return changes;
}
/** Approximate area changes for one authorized employee and one organization-local day. */
export function locationHistoryReport(date: string, timezone: string, employeeName: string, changes: AreaChange[]) {
  localDateSchema.parse(date);
  const localTime = new Intl.DateTimeFormat('en-GB', { timeZone: timezone, year: 'numeric', month: '2-digit',
    day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
  const rows: string[][] = [['Employee', 'First recorded near area (local)', 'Time zone', 'First recorded near area (UTC)',
    'Nearby area (English where mapped, approximate)', 'Latitude', 'Longitude', 'Accuracy (m)', 'Mock location', 'Quality flags', 'Map link']];
  for (const { point, label } of changes) {
    const latitude = String(point.latitude), longitude = String(point.longitude);
    rows.push([employeeName, localTime.format(new Date(point.captured_at)), timezone,
      new Date(point.captured_at).toISOString(), label ?? 'No nearby English area name', latitude, longitude, String(point.accuracy_m),
      point.mock_location ? 'Yes' : 'No', (point.quality_flags ?? []).join('; '),
      googleMapsPointUrl(latitude, longitude)]);
  }
  return '\uFEFF' + rows.map(row => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}
export function csvCell(value: string) {
  // Quoting alone does not stop spreadsheet formula execution, including whitespace prefixes.
  const safe = /^[\s\uFEFF]*[=+@-]/u.test(value) || /^[\t\r\n]/u.test(value) ? "'" + value : value;
  return '"' + safe.replaceAll('"', '""') + '"';
}
