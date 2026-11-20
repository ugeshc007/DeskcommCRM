import { describe, expect, it } from 'vitest';
import { businessHoursSchema, businessHoursState } from './business-hours';
import { conditionCheckSchema } from './graph-schema';

const schedule = { tz: 'Asia/Dubai', days: ['mon'] as ['mon'], start: '09:00', end: '17:00' };
describe('builder business hours', () => {
  it('uses the selected timezone and inclusive opening / exclusive closing', () => {
    expect(businessHoursState(schedule, new Date('2026-09-14T04:59:00Z'))).toBe('closed');
    expect(businessHoursState(schedule, new Date('2026-09-14T05:00:00Z'))).toBe('open');
    expect(businessHoursState(schedule, new Date('2026-09-14T12:59:00Z'))).toBe('open');
    expect(businessHoursState(schedule, new Date('2026-09-14T13:00:00Z'))).toBe('closed');
    expect(businessHoursState(schedule, new Date('2026-09-15T05:00:00Z'))).toBe('closed');
  });
  it('uses calendar timezone rules through daylight saving transitions', () => {
    const london = { ...schedule, tz: 'Europe/London' };
    expect(businessHoursState(london, new Date('2026-07-06T08:00:00Z'))).toBe('open');
    expect(businessHoursState(london, new Date('2026-12-07T08:00:00Z'))).toBe('closed');
    expect(businessHoursState(london, new Date('2026-12-07T09:00:00Z'))).toBe('open');
  });
  it.each([{ tz: 'invalid/zone' }, { days: [] }, { days: ['mon', 'mon'] }, { start: '24:00' }, { end: '09:00' }, { start: '18:00' }])('rejects invalid schedules %j', invalid => {
    expect(businessHoursSchema.safeParse({ ...schedule, ...invalid }).success).toBe(false);
  });
  it('requires explicit schedule and only supported state comparisons', () => {
    const check = { field: 'business_hours', op: 'eq', value: 'open', schedule };
    expect(conditionCheckSchema.safeParse(check).success).toBe(true);
    expect(conditionCheckSchema.safeParse({ ...check, schedule: undefined }).success).toBe(false);
    expect(conditionCheckSchema.safeParse({ ...check, value: 'unknown' }).success).toBe(false);
    expect(conditionCheckSchema.safeParse({ ...check, op: 'gte' }).success).toBe(false);
  });
});
