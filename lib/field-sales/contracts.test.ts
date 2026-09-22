import { describe, expect, it } from 'vitest';
import { attendanceCommandSchema, collectsLocation, latestSample, locationSampleSchema, organizationRegion, projectSchema,
  sampleWithinSession, scheduleSchema, transitionAttendance } from './contracts';
import { expandSchedule, overlappingAssignments, wallTimeToUtc, localParts, mondayOfWeek } from './schedule';

const session = '00000000-0000-4000-8000-000000000001';
const project = '00000000-0000-4000-8000-000000000002';
const employee = '00000000-0000-4000-8000-000000000003';
const sample = { sample_id: project, session_id: session, sequence: 1,
  captured_at: '2026-09-18T08:00:00Z', latitude: 25, longitude: 55, accuracy_m: 10, mock_location: false };
const rule = { project_id: project, employee_id: employee, start_date: '2026-09-21',
  end_date: null, start_time: '09:00', end_time: '11:00', end_day_offset: 0 as const,
  repeat: 'weekly' as const, weekdays: [1, 3, 5], instructions: '' };

describe('field sales authority-independent contracts', () => {
  it('renders correction dates in the organization zone and round trips the selected minute', () => {
    const local = localParts(Date.parse('2026-09-21T05:30:00Z'), 'Asia/Dubai');
    expect(local).toBe('2026-09-21T09:30');
    expect(wallTimeToUtc(local.slice(0, 10), local.slice(11), 'Asia/Dubai')).toBe('2026-09-21T05:30:00.000Z');
  });
  it('inherits the CRM organization region without using browser defaults', () => {
    expect(organizationRegion({ timezone: 'Asia/Dubai', onboarding_state: { welcome: { country_code: 'AE' } } }).success).toBe(true);
    expect(organizationRegion({ timezone: null, onboarding_state: { welcome: { country_code: 'AE' } } }).success).toBe(false);
    expect(organizationRegion({ timezone: 'Asia/Dubai', onboarding_state: { welcome: { country_code: 'XX' } } }).success).toBe(false);
  });
  it('tracks breaks but never off-duty time', () => {
    expect(collectsLocation(transitionAttendance('off_duty', 'punch_in'))).toBe(true);
    expect(collectsLocation(transitionAttendance('working', 'break_start'))).toBe(true);
    expect(transitionAttendance('on_break', 'break_end')).toBe('working');
    expect(collectsLocation(transitionAttendance('on_break', 'punch_out'))).toBe(false);
    expect(transitionAttendance('working', 'punch_out')).toBe('off_duty');
  });
  it.each([['off_duty', 'punch_out'], ['working', 'punch_in'], ['on_break', 'break_start'],
    ['off_duty', 'break_start'], ['working', 'break_end']] as const)('rejects %s -> %s', (status, action) => {
    expect(() => transitionAttendance(status, action)).toThrow('field_invalid_transition');
  });
  it('permits historical offline samples inside the interval, not at/after punch-out', () => {
    const interval = { id: session, punched_in_at: '2026-09-18T07:00:00Z', punched_out_at: '2026-09-18T09:00:00Z' };
    expect(sampleWithinSession(sample, interval)).toBe(true);
    expect(sampleWithinSession({ ...sample, captured_at: interval.punched_out_at }, interval)).toBe(false);
    expect(sampleWithinSession({ ...sample, captured_at: '2026-09-18T06:59:59Z' }, interval)).toBe(false);
    expect(sampleWithinSession({ ...sample, session_id: project }, interval)).toBe(false);
  });
  it('out-of-order delivery never replaces a newer position', () => {
    const newer = { ...sample, captured_at: '2026-09-18T08:10:00Z', sequence: 2 };
    expect(latestSample([newer, sample])).toEqual(newer);
    expect(latestSample([])).toBeNull();
  });
  it('rejects payload identity injection and invalid coordinates', () => {
    expect(locationSampleSchema.safeParse({ ...sample, organization_id: project }).success).toBe(false);
    expect(locationSampleSchema.safeParse({ ...sample, latitude: 91 }).success).toBe(false);
    expect(locationSampleSchema.safeParse({ ...sample, accuracy_m: -1 }).success).toBe(false);
  });
  it('starts a session before project selection and requires an explicit selection event', () => {
    const common = { event_id: employee, session_id: session, sequence: 0, captured_at: '2026-09-21T05:00:00Z' };
    expect(attendanceCommandSchema.safeParse({ ...common, action: 'punch_in' }).success).toBe(false);
    expect(attendanceCommandSchema.safeParse({ ...common, action: 'punch_in', local_date: '2026-09-21' }).success).toBe(true);
    expect(attendanceCommandSchema.safeParse({ ...common, action: 'punch_in', project_id: project,
      schedule_id: session, local_date: '2026-09-21' }).success).toBe(true);
    expect(attendanceCommandSchema.safeParse({ ...common, sequence: 1, action: 'select_project', project_id: project,
      schedule_id: null, local_date: '2026-09-21' }).success).toBe(true);
    expect(attendanceCommandSchema.safeParse({ ...common, sequence: 1, action: 'select_project', project_id: project }).success).toBe(false);
    expect(attendanceCommandSchema.safeParse({ ...common, action: 'punch_out' }).success).toBe(true);
  });
  it('requires paired site coordinates', () => {
    expect(projectSchema.safeParse({ name: 'A', customer_id: null, site_name: 'Site', address: '',
      latitude: 25, longitude: null, instructions: '', active: true }).success).toBe(false);
  });
});

describe('organization-local recurring project schedule', () => {
  it('shows a Monday-to-Sunday planning week', () => {
    expect(mondayOfWeek('2026-09-22')).toBe('2026-09-21');
    expect(mondayOfWeek('2026-09-27')).toBe('2026-09-21');
  });
  const input = { series_id: session, schedule: rule, region: { country_code: 'AE', timezone: 'Asia/Dubai' },
    from: '2026-09-21', through: '2026-09-27' };
  it('expands weekly selected weekdays in the CRM timezone with stable keys', () => {
    const rows = expandSchedule(input);
    expect(rows.map(row => row.date)).toEqual(['2026-09-21', '2026-09-23', '2026-09-25']);
    expect(rows[0]!.starts_at).toBe('2026-09-21T05:00:00.000Z');
    expect(rows[0]!.occurrence_key).toBe(`${session}:2026-09-21`);
    expect(expandSchedule({ ...input, from: '2026-09-23' })[0]).toEqual(rows[1]);
  });
  it('supports cancellation, inclusive end date and one-time assignments', () => {
    expect(expandSchedule({ ...input, cancelled_dates: ['2026-09-23'], schedule: { ...rule, end_date: '2026-09-23' } })).toHaveLength(1);
    expect(expandSchedule({ ...input, schedule: { ...rule, repeat: 'once', weekdays: [] } })).toHaveLength(1);
  });
  it('supports overnight assignments without silently treating inverted times as overnight', () => {
    expect(scheduleSchema.safeParse({ ...rule, start_time: '22:00', end_time: '02:00' }).success).toBe(false);
    const row = expandSchedule({ ...input, schedule: { ...rule, start_time: '22:00', end_time: '02:00', end_day_offset: 1 } })[0];
    expect(row!.ends_at).toBe('2026-09-21T22:00:00.000Z');
  });
  it('expands an untimed weekly assignment as an all-day choice without a fixed working shift', () => {
    const untimed = { ...rule, start_time: null, end_time: null, weekdays: [1, 6] };
    const rows = expandSchedule({ ...input, schedule: untimed });
    expect(rows.map(row => row.date)).toEqual(['2026-09-21', '2026-09-26']);
    expect(rows.every(row => row.untimed)).toBe(true);
    expect(overlappingAssignments(rows)).toHaveLength(0);
    expect(scheduleSchema.safeParse({ ...untimed, end_time: '17:00' }).success).toBe(false);
  });
  it('flags actual employee overlap but permits adjacent slots and different employees', () => {
    const row = expandSchedule(input)[0]!;
    const other = { ...row, occurrence_key: 'other' };
    expect(overlappingAssignments([row, other])).toHaveLength(1);
    expect(overlappingAssignments([row, { ...other, employee_id: project }])).toHaveLength(0);
    expect(overlappingAssignments([row, { ...other, starts_at: row.ends_at }])).toHaveLength(0);
  });
  it('handles non-whole-hour zones and DST without guessing', () => {
    expect(wallTimeToUtc('2026-09-21', '09:00', 'Asia/Kolkata')).toBe('2026-09-21T03:30:00.000Z');
    expect(() => wallTimeToUtc('2026-03-08', '02:30', 'America/New_York')).toThrow('field_nonexistent_local_time');
    expect(() => wallTimeToUtc('2026-11-01', '01:30', 'America/New_York')).toThrow('field_ambiguous_local_time');
  });
  it('rejects invalid dates, unbounded calendar reads and empty weekly rules', () => {
    expect(() => expandSchedule({ ...input, through: '2027-09-21' })).toThrow('field_calendar_window_too_large');
    expect(scheduleSchema.safeParse({ ...rule, start_date: '2026-02-30' }).success).toBe(false);
    expect(scheduleSchema.safeParse({ ...rule, weekdays: [] }).success).toBe(false);
    expect(scheduleSchema.safeParse({ ...rule, weekdays: [1, 1] }).success).toBe(false);
  });
});
