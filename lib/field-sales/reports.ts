import { addCalendarDays, wallTimeToUtc } from './schedule';
import { localDateSchema } from './contracts';

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
export function csvCell(value: string) {
  // Quoting alone does not stop spreadsheet formula execution, including whitespace prefixes.
  const safe = /^[\s\uFEFF]*[=+@-]/u.test(value) || /^[\t\r\n]/u.test(value) ? "'" + value : value;
  return '"' + safe.replaceAll('"', '""') + '"';
}
