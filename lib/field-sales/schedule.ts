import { localDateSchema, regionSchema, scheduleSchema, type FieldSchedule } from './contracts';

const DAY = 86400000;
export function addCalendarDays(date: string, days: number): string {
  localDateSchema.parse(date);
  return new Date(Date.parse(date + 'T00:00:00Z') + days * DAY).toISOString().slice(0, 10);
}

export function localParts(epoch: number, timezone: string): string {
  const p = new Intl.DateTimeFormat('en-GB', { timeZone: timezone, year: 'numeric',
    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(new Date(epoch));
  const part = (type: string) => p.find(item => item.type === type)?.value;
  return `${part('year')}-${part('month')}-${part('day')}T${part('hour')}:${part('minute')}`;
}

/** Collect possible UTC instants. Reject DST gaps/folds rather than silently moving a visit. */
export function wallTimeToUtc(date: string, time: string, timezone: string): string {
  localDateSchema.parse(date);
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new Error('field_invalid_time');
  const target = `${date}T${time}`, nominal = Date.parse(target + ':00Z');
  const offsets = new Set<number>();
  // Sample both sides of an offset transition, including half-hour/quarter-hour zones.
  for (let hours = -48; hours <= 48; hours += 6) {
    const probe = nominal + hours * 3600000;
    offsets.add(Date.parse(localParts(probe, timezone) + ':00Z') - probe);
  }
  const matches = [...offsets].map(offset => nominal - offset)
    .filter(epoch => localParts(epoch, timezone) === target);
  if (!matches.length) throw new Error('field_nonexistent_local_time');
  if (matches.length !== 1) throw new Error('field_ambiguous_local_time');
  return new Date(matches[0]!).toISOString();
}

export interface ScheduleOccurrence {
  occurrence_key: string;
  date: string;
  starts_at: string;
  ends_at: string;
  project_id: string;
  employee_id: string;
}

export function expandSchedule(input: {
  series_id: string; schedule: FieldSchedule; region: { country_code: string; timezone: string };
  from: string; through: string; cancelled_dates?: readonly string[];
}): ScheduleOccurrence[] {
  const rule = scheduleSchema.parse(input.schedule), region = regionSchema.parse(input.region);
  localDateSchema.parse(input.from); localDateSchema.parse(input.through);
  const span = Date.parse(input.through) - Date.parse(input.from);
  // Bounded read window, not a business limit on recurrence duration.
  if (span < 0 || span > 92 * DAY) throw new Error('field_calendar_window_too_large');
  const cancelled = new Set(input.cancelled_dates ?? []), output: ScheduleOccurrence[] = [];
  const from = input.from > rule.start_date ? input.from : rule.start_date;
  const through = rule.end_date && rule.end_date < input.through ? rule.end_date : input.through;
  for (let date = from; date <= through; date = addCalendarDays(date, 1)) {
    if (cancelled.has(date)) continue;
    const weekday = new Date(date + 'T00:00:00Z').getUTCDay() || 7;
    if (rule.repeat === 'once' ? date !== rule.start_date : !rule.weekdays.includes(weekday)) continue;
    const starts_at = wallTimeToUtc(date, rule.start_time, region.timezone);
    const ends_at = wallTimeToUtc(addCalendarDays(date, rule.end_day_offset), rule.end_time, region.timezone);
    if (Date.parse(ends_at) <= Date.parse(starts_at)) throw new Error('field_invalid_duration');
    output.push({ occurrence_key: `${input.series_id}:${date}`, date, starts_at, ends_at,
      project_id: rule.project_id, employee_id: rule.employee_id });
  }
  return output;
}

export function overlappingAssignments(rows: readonly ScheduleOccurrence[]): Array<[string, string]> {
  const clashes: Array<[string, string]> = [];
  const sorted = [...rows].sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at));
  for (let i = 0; i < sorted.length; i++) for (let j = i + 1; j < sorted.length; j++) {
    const a = sorted[i]!, b = sorted[j]!;
    if (Date.parse(b.starts_at) >= Date.parse(a.ends_at)) break;
    if (a.employee_id === b.employee_id)
      clashes.push([a.occurrence_key, b.occurrence_key]);
  }
  return clashes;
}
