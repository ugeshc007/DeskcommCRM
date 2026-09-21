import { z } from 'zod';
import { countries } from 'countries-list';

/** Country/timezone are read from the organization, never the phone locale. */
export const regionSchema = z.strictObject({
  country_code: z.string().refine(value => Object.hasOwn(countries, value), 'Configure the organization country.'),
  timezone: z.string().min(1).max(100).refine(value => {
    try { new Intl.DateTimeFormat('en', { timeZone: value }).format(); return true; }
    catch { return false; }
  }, 'Configure a valid organization time zone.'),
});

export function organizationRegion(raw: unknown) {
  const org = z.object({ timezone: z.unknown(), onboarding_state: z.object({
    welcome: z.object({ country_code: z.unknown() }),
  }) }).safeParse(raw);
  return regionSchema.safeParse(org.success ? {
    country_code: org.data.onboarding_state.welcome.country_code,
    timezone: org.data.timezone,
  } : null);
}

export const localDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const date = new Date(value + 'T00:00:00.000Z');
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}, 'Choose a valid calendar date.');
export const localTimeSchema = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/);
const instant = z.iso.datetime({ offset: true });

export const projectSchema = z.strictObject({
  name: z.string().trim().min(1).max(160),
  customer_id: z.uuid().nullable(),
  site_name: z.string().trim().min(1).max(160),
  address: z.string().trim().max(1000),
  latitude: z.number().min(-90).max(90).nullable(),
  longitude: z.number().min(-180).max(180).nullable(),
  instructions: z.string().max(4000),
  active: z.boolean(),
}).refine(value => (value.latitude === null) === (value.longitude === null), {
  message: 'Provide both site coordinates, or neither.', path: ['latitude'],
});

export const scheduleSchema = z.strictObject({
  project_id: z.uuid(), employee_id: z.uuid(),
  start_date: localDateSchema, end_date: localDateSchema.nullable(),
  start_time: localTimeSchema.nullable(), end_time: localTimeSchema.nullable(),
  end_day_offset: z.union([z.literal(0), z.literal(1)]),
  repeat: z.enum(['once', 'weekly']),
  weekdays: z.array(z.number().int().min(1).max(7)).max(7),
  instructions: z.string().max(4000),
}).superRefine((value, ctx) => {
  if (value.end_date && value.end_date < value.start_date)
    ctx.addIssue({ code: 'custom', path: ['end_date'], message: 'End date must not precede start date.' });
  if ((value.start_time === null) !== (value.end_time === null))
    ctx.addIssue({ code: 'custom', path: ['end_time'], message: 'Provide both times or leave both blank for an untimed assignment.' });
  if (value.start_time === null && value.end_day_offset !== 0)
    ctx.addIssue({ code: 'custom', path: ['end_day_offset'], message: 'An untimed assignment cannot end on the following day.' });
  if (value.start_time !== null && value.end_time !== null && value.end_day_offset === 0 && value.end_time <= value.start_time)
    ctx.addIssue({ code: 'custom', path: ['end_time'], message: 'End time must be after start; select next day for overnight visits.' });
  if (value.repeat === 'weekly' && !value.weekdays.length)
    ctx.addIssue({ code: 'custom', path: ['weekdays'], message: 'Choose at least one recurring weekday.' });
  if (new Set(value.weekdays).size !== value.weekdays.length)
    ctx.addIssue({ code: 'custom', path: ['weekdays'], message: 'Weekdays must be unique.' });
  if (value.repeat === 'once' && (value.weekdays.length || (value.end_date && value.end_date !== value.start_date)))
    ctx.addIssue({ code: 'custom', path: ['repeat'], message: 'A one-time assignment has one date and no recurring weekdays.' });
});
export type FieldSchedule = z.infer<typeof scheduleSchema>;

const attendanceBase = {
  event_id: z.uuid(), session_id: z.uuid(), captured_at: instant,
  // Sequence is local to a work session. Server enforces contiguous transitions.
  sequence: z.number().int().min(0).max(10000),
};
export const attendanceCommandSchema = z.discriminatedUnion('action', [
  z.strictObject({ ...attendanceBase, action: z.literal('punch_in'),
    local_date: localDateSchema, project_id: z.uuid().optional(), schedule_id: z.uuid().optional() }),
  z.strictObject({ ...attendanceBase, action: z.literal('select_project'),
    project_id: z.uuid(), schedule_id: z.uuid().nullable(), local_date: localDateSchema }),
  z.strictObject({ ...attendanceBase, action: z.enum(['break_start', 'break_end', 'punch_out']),
    project_id: z.uuid().optional(), schedule_id: z.uuid().optional(), local_date: localDateSchema.optional() }),
]);
export type AttendanceCommand = z.infer<typeof attendanceCommandSchema>;
export type WorkStatus = 'off_duty' | 'working' | 'on_break';
export const MAX_FIELD_SHIFT_MS = 14 * 60 * 60 * 1000;

export function transitionAttendance(status: WorkStatus, action: AttendanceCommand['action']): WorkStatus {
  if (status === 'off_duty' && action === 'punch_in') return 'working';
  if (status !== 'off_duty' && action === 'select_project') return status;
  if (status === 'working' && action === 'break_start') return 'on_break';
  if (status === 'on_break' && action === 'break_end') return 'working';
  if (status !== 'off_duty' && action === 'punch_out') return 'off_duty';
  throw new Error('field_invalid_transition');
}

/** Confirmed policy: a declared break still belongs to the tracked working session. */
export function collectsLocation(status: WorkStatus): boolean {
  return status === 'working' || status === 'on_break';
}

export const locationSampleSchema = z.strictObject({
  sample_id: z.uuid(), session_id: z.uuid(), captured_at: instant,
  sequence: z.number().int().nonnegative().max(2147483647),
  latitude: z.number().min(-90).max(90), longitude: z.number().min(-180).max(180),
  accuracy_m: z.number().min(0).max(100000),
  mock_location: z.boolean(),
});
export type LocationSample = z.infer<typeof locationSampleSchema>;
export const locationBatchSchema = z.strictObject({ samples: z.array(locationSampleSchema).min(1).max(100) });

export interface WorkInterval {
  id: string;
  punched_in_at: string;
  punched_out_at: string | null;
}

/** Half-open work interval: no point at or after punch-out is admissible. */
export function sampleWithinSession(sample: LocationSample, session: WorkInterval): boolean {
  const at = Date.parse(sample.captured_at), start = Date.parse(session.punched_in_at);
  const end = Math.min(session.punched_out_at === null ? Infinity : Date.parse(session.punched_out_at), start + MAX_FIELD_SHIFT_MS);
  return sample.session_id === session.id && Number.isFinite(at) && Number.isFinite(start) && at >= start && at < end;
}

export function latestSample<T extends Pick<LocationSample, 'captured_at' | 'sequence'>>(samples: readonly T[]): T | null {
  return samples.reduce<T | null>((latest, point) => {
    if (!latest) return point;
    const delta = Date.parse(point.captured_at) - Date.parse(latest.captured_at);
    return delta > 0 || (delta === 0 && point.sequence > latest.sequence) ? point : latest;
  }, null);
}
