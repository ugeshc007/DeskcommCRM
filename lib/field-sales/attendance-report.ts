import { addCalendarDays, wallTimeToUtc } from './schedule';
import { localDateSchema } from './contracts';
import { displayRoute, reliablePosition, type RecordedPoint, type RouteQualityConfig } from './route-quality';

type Instant = string | Date;
export type AttendanceSession = { id: string; employee_id: string; punched_in_at: Instant; punched_out_at: Instant | null;
  corrected_in: Instant | null; corrected_out: Instant | null };
export type AttendanceEvent = { session_id: string; action: string; captured_at: Instant };
export type AttendancePerson = { user_id: string; display_name: string; active: boolean };
export type AttendanceLeave = { employee_id: string; note: string };
export type AttendancePoint = Omit<RecordedPoint, 'captured_at'> & { employee_id: string; captured_at: Instant };

const epoch = (value: Instant) => new Date(value).getTime();
function overlap(start: number, end: number, dayStart: number, dayEnd: number) {
  return Math.max(0, Math.min(end, dayEnd) - Math.max(start, dayStart));
}
export function dailyAttendance(date: string, timezone: string, observedAt: Instant, people: AttendancePerson[],
  sessions: AttendanceSession[], events: AttendanceEvent[], leaves: AttendanceLeave[], points: AttendancePoint[],
  quality: RouteQualityConfig) {
  localDateSchema.parse(date);
  const dayStart = Date.parse(wallTimeToUtc(date, '00:00', timezone));
  const dayEnd = Date.parse(wallTimeToUtc(addCalendarDays(date, 1), '00:00', timezone));
  const now = epoch(observedAt);
  return people.map(person => {
    const ownSessions = sessions.filter(session => session.employee_id === person.user_id);
    let workedMs = 0, breakMs = 0, firstIn = Infinity, lastOut = -Infinity, open = false;
    for (const session of ownSessions) {
      const start = epoch(session.corrected_in ?? session.punched_in_at);
      const end = session.corrected_out ? epoch(session.corrected_out) : session.punched_out_at ? epoch(session.punched_out_at) : now;
      const clipped = overlap(start, end, dayStart, Math.min(dayEnd, now));
      if (!clipped) continue;
      workedMs += clipped;
      firstIn = Math.min(firstIn, start);
      if (session.punched_out_at) lastOut = Math.max(lastOut, end);
      else open = true;
      const ordered = events.filter(event => event.session_id === session.id).sort((a, b) => epoch(a.captured_at) - epoch(b.captured_at));
      let breakStart: number | null = null;
      for (const event of ordered) {
        if (event.action === 'break_start') breakStart = epoch(event.captured_at);
        if ((event.action === 'break_end' || event.action === 'punch_out') && breakStart !== null) {
          breakMs += overlap(Math.max(start, breakStart), Math.min(end, epoch(event.captured_at)), dayStart, Math.min(dayEnd, now));
          breakStart = null;
        }
      }
      if (breakStart !== null) breakMs += overlap(Math.max(start, breakStart), end, dayStart, Math.min(dayEnd, now));
    }
    const ownPoints = points.filter(point => point.employee_id === person.user_id).map(point => ({
      ...point, captured_at: new Date(point.captured_at).toISOString(),
    }));
    const route = displayRoute(ownPoints, quality);
    const reliablePoints = ownPoints.filter(point => point.accuracy_m <= quality.routeAccuracyM && reliablePosition(point, quality)).length;
    const leave = leaves.find(item => item.employee_id === person.user_id);
    const status = !person.active ? 'inactive' : workedMs > 0 ? 'present' : leave ? 'leave'
      : now >= dayEnd ? 'absent' : 'pending';
    return { employee_id: person.user_id, display_name: person.display_name, status,
      leave_conflict: Boolean(leave && workedMs > 0),
      leave_note: leave?.note ?? null, first_in_at: Number.isFinite(firstIn) ? new Date(firstIn).toISOString() : null,
      last_out_at: Number.isFinite(lastOut) ? new Date(lastOut).toISOString() : null,
      open, working_minutes: Math.round(Math.max(0, workedMs - breakMs) / 60000),
      break_minutes: Math.round(breakMs / 60000), travel_distance_m: reliablePoints >= 3 ? Math.round(route.distance_m) : null,
      gps_points: ownPoints.length, reliable_route_points: route.plotted.length };
  });
}
