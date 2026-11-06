import { z } from 'zod';
import { inBusinessHours } from '@/lib/ai/dispatcher/triggers';

export const BUSINESS_DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
const time = z.string().regex(/^(?:[01][0-9]|2[0-3]):[0-5][0-9]$/);
/** Horário do bloco é explícito; não altera a agenda/disponibilidade da equipe. */
export const businessHoursSchema = z.strictObject({
  tz: z.string().min(1).max(80).refine(value => {
    try { new Intl.DateTimeFormat('en', { timeZone: value }).format(); return true; } catch { return false; }
  }, 'Choose a valid IANA time zone.'),
  days: z.array(z.enum(BUSINESS_DAYS)).min(1).max(7).refine(days => new Set(days).size === days.length),
  start: time,
  end: time,
}).refine(value => value.start < value.end, 'Use a same-day opening interval; closing time must be after opening time.');
export type BusinessHours = z.infer<typeof businessHoursSchema>;
export function businessHoursState(raw: unknown, now: Date): 'open' | 'closed' {
  const config = businessHoursSchema.parse(raw);
  if (!Number.isFinite(now.getTime())) throw new Error('business_hours_clock_invalid');
  return inBusinessHours(config, now) ? 'open' : 'closed';
}
