import { describe, expect, it } from 'vitest';
import { dailyAttendance } from './attendance-report';
import { DEFAULT_ROUTE_QUALITY } from './route-quality';

const person = [{ user_id: 'officer', display_name: 'Officer', active: true }];
const report = (date: string, observedAt: string, sessions: Parameters<typeof dailyAttendance>[4] = [],
  events: Parameters<typeof dailyAttendance>[5] = [], leaves: Parameters<typeof dailyAttendance>[6] = [],
  points: Parameters<typeof dailyAttendance>[7] = []) => dailyAttendance(date, 'Asia/Dubai', observedAt,
  person, sessions, events, leaves, points, DEFAULT_ROUTE_QUALITY)[0]!;

describe('daily attendance from punches', () => {
  it('does not call an unpunched current day Absent, but marks it after local midnight', () => {
    expect(report('2026-09-25', '2026-09-25T12:00:00Z').status).toBe('pending');
    expect(report('2026-09-25', '2026-09-25T20:00:00Z').status).toBe('absent');
    expect(report('2026-09-25', '2026-09-25T20:00:00Z', [], [], [{ employee_id: 'officer', note: 'Approved' }]).status).toBe('leave');
  });
  it('splits an overnight shift and subtracts its recorded break in each local day', () => {
    const session = { id: 'shift', employee_id: 'officer', punched_in_at: '2026-09-24T18:00:00Z',
      punched_out_at: '2026-09-24T22:00:00Z', corrected_in: null, corrected_out: null };
    const events = [{ session_id: 'shift', action: 'break_start', captured_at: '2026-09-24T19:30:00Z' },
      { session_id: 'shift', action: 'break_end', captured_at: '2026-09-24T20:30:00Z' }];
    const first = report('2026-09-24', '2026-09-25T00:00:00Z', [session], events);
    const second = report('2026-09-25', '2026-09-25T00:00:00Z', [session], events);
    expect(first.working_minutes).toBe(90);
    expect(second.working_minutes).toBe(90);
    expect(first.status).toBe('present');
    expect(second.status).toBe('present');
  });
  it('reports GPS unavailable rather than zero when no measured route exists', () => {
    expect(report('2026-09-24', '2026-09-25T00:00:00Z').travel_distance_m).toBeNull();
    const poor = [0, 1, 2].map(index => ({ employee_id: 'officer', session_id: 'shift',
      latitude: 25 + index * 0.001, longitude: 55, captured_at: `2026-09-24T12:0${index}:00Z`,
      accuracy_m: 250, mock_location: false, quality_flags: ['poor_accuracy'] }));
    expect(report('2026-09-24', '2026-09-25T00:00:00Z', [], [], [], poor).travel_distance_m).toBeNull();
  });
});
