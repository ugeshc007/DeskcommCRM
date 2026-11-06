import { scheduleSchema, type FieldSchedule } from './contracts';
import { addCalendarDays, expandSchedule } from './schedule';

/** Split future work into a new series; the original identity remains attached to history. */
export function planReschedule(input: {
  old: FieldSchedule; replacement: FieldSchedule; scope: 'one' | 'future'; date: string;
  region: { country_code: string; timezone: string }; now: string;
}) {
  const old = scheduleSchema.parse(input.old), replacement = scheduleSchema.parse(input.replacement);
  const occurrence = expandSchedule({ series_id: 'existing', schedule: old, region: input.region,
    from: input.date, through: input.date })[0];
  if (!occurrence) throw new Error('field_assignment_unavailable');
  if (Date.parse(occurrence.starts_at) <= Date.parse(input.now)) throw new Error('field_history_immutable');
  if (replacement.start_date !== input.date || (input.scope === 'one' && replacement.repeat !== 'once'))
    throw new Error('field_invalid_edit_scope');
  const newOccurrences = expandSchedule({ series_id: 'replacement', schedule: replacement, region: input.region,
    from: input.date, through: addCalendarDays(input.date, 6) });
  if (!newOccurrences.length) throw new Error('field_assignment_unavailable');
  if (newOccurrences.some(o => Date.parse(o.starts_at) <= Date.parse(input.now))) throw new Error('field_history_immutable');
  return {
    replacement,
    old_rule: input.scope === 'future' && input.date > old.start_date ? { ...old, end_date: addCalendarDays(input.date, -1) } : old,
    deactivate_old: input.scope === 'future' && input.date <= old.start_date,
    cancel_date: input.scope === 'one' ? input.date : null,
  };
}
