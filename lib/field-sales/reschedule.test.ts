import { describe, expect, it } from 'vitest';
import { planReschedule } from './reschedule';
import type { FieldSchedule } from './contracts';
const old: FieldSchedule = { project_id: '11111111-1111-4111-8111-111111111111', employee_id: '22222222-2222-4222-8222-222222222222',
  start_date: '2026-09-21', end_date: null, start_time: '09:00', end_time: '10:00', end_day_offset: 0, repeat: 'weekly', weekdays: [1, 3], instructions: '' };
const region = { country_code: 'AE', timezone: 'Asia/Dubai' }, now = '2026-09-18T00:00:00Z';
describe('history-preserving calendar edits', () => {
  it('changes one visit without changing the recurring rule', () => {
    const result = planReschedule({ old, replacement: { ...old, start_date: '2026-09-23', repeat: 'once', weekdays: [] }, date: '2026-09-23', scope: 'one', region, now });
    expect(result.old_rule).toEqual(old); expect(result.cancel_date).toBe('2026-09-23'); expect(result.deactivate_old).toBe(false);
  });
  it('ends the original series the day before a future split', () => {
    const result = planReschedule({ old, replacement: { ...old, start_date: '2026-09-23' }, date: '2026-09-23', scope: 'future', region, now });
    expect(result.old_rule.end_date).toBe('2026-09-22'); expect(result.cancel_date).toBeNull();
  });
  it('replaces a wholly future series without an invalid end-before-start rule', () => {
    expect(planReschedule({ old, replacement: old, date: old.start_date, scope: 'future', region, now }).deactivate_old).toBe(true);
  });
  it('rejects started work and edits on dates without an occurrence', () => {
    expect(() => planReschedule({ old, replacement: old, date: old.start_date, scope: 'future', region, now: '2026-09-21T05:00:00Z' })).toThrow('field_history_immutable');
    expect(() => planReschedule({ old, replacement: old, date: '2026-09-22', scope: 'future', region, now })).toThrow('field_assignment_unavailable');
  });
  it('rejects one-visit edits that accidentally create a recurring series', () => {
    expect(() => planReschedule({ old, replacement: old, date: old.start_date, scope: 'one', region, now })).toThrow('field_invalid_edit_scope');
  });
});
