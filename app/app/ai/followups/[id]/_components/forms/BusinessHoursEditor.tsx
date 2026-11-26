'use client';
import { Input } from '@/components/ui/input';
import { BUSINESS_DAYS, type BusinessHours } from '@/lib/followup/business-hours';
import { DIAS_DA_SEMANA } from '@/lib/followup/vocabulario';

export function BusinessHoursEditor({ value, onChange }: { value: BusinessHours; onChange: (next: BusinessHours) => void }) {
  return <fieldset className="space-y-3 rounded-md border border-border p-3">
    <legend className="px-1 text-xs">Opening schedule</legend>
    <label className="block space-y-1 text-xs">Time zone (IANA)
      <Input value={value.tz} placeholder="Asia/Dubai" maxLength={80} onChange={e => onChange({ ...value, tz: e.target.value })} />
    </label>
    <div className="flex flex-wrap gap-3">{BUSINESS_DAYS.map(day => <label key={day} className="flex items-center gap-1 text-xs">
      <input type="checkbox" checked={value.days.includes(day)} onChange={e => onChange({ ...value, days: e.target.checked ? [...value.days, day] : value.days.filter(d => d !== day) })} />{DIAS_DA_SEMANA[day]}
    </label>)}</div>
    <div className="grid grid-cols-2 gap-2">
      <label className="block space-y-1 text-xs">Opens<Input type="time" value={value.start} onChange={e => onChange({ ...value, start: e.target.value })} /></label>
      <label className="block space-y-1 text-xs">Closes<Input type="time" value={value.end} onChange={e => onChange({ ...value, end: e.target.value })} /></label>
    </div>
    <p className="text-xs text-text-muted">Checked when the flow reaches this block. This does not change team availability. Use a same-day interval; opening is inclusive and closing is exclusive.</p>
  </fieldset>;
}
