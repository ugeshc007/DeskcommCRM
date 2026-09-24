'use client';

import { Button } from '@/components/ui/button';
import { livePosition } from '@/lib/field-sales/route-quality';
import type { Operations } from './operations';

export function OfficerCards({ people, timezone, date, generatedAt, selectedEmployeeId, onSelect }: {
  people: Operations['latest']; timezone: string; date: string; generatedAt: string; selectedEmployeeId: string;
  onSelect: (employeeId: string) => void;
}) {
  const time = (value: string | null) => value
    ? new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short', timeZone: timezone }).format(new Date(value)) : 'Not reported';
  const onDuty = people.filter(person => person.status);
  const onlineOffDuty = people.filter(person => !person.status && person.online);
  const offDuty = people.filter(person => !person.status && !person.online);
  const cards = (items: Operations['latest']) => <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{items.map(person => <article
    key={person.employee_id} className={`rounded-xl border bg-card p-4 ${selectedEmployeeId === person.employee_id ? 'border-primary bg-primary/5' : ''}`}>
    <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-semibold">{person.display_name}</h3>
      <span className={`rounded-full px-2 py-1 text-xs font-medium ${person.status ? person.online ? 'bg-emerald-100 text-emerald-900' : 'bg-amber-100 text-amber-900' : 'bg-muted text-muted-foreground'}`}>
        {person.status === 'on_break' ? person.online ? 'On duty · on break' : 'On break · App offline'
          : person.status ? person.online ? 'On duty · working' : 'Punch-in recorded · App offline' : 'Off duty'}
      </span></div>
    <p className="mt-2 text-sm">{person.online ? 'Online' : 'Offline'} · App last checked in: {time(person.last_seen_at)}</p>
    {!person.online && person.status && <p className="mt-1 text-sm text-amber-700">Phone offline. Last known GPS is historical; there is no current live map pin.</p>}
    {person.online && person.status && person.captured_at && !livePosition(person, generatedAt)
      && <p className="mt-1 text-sm text-amber-700">Phone online, but no recent reliable GPS. Last known position is historical; there is no current live map pin.</p>}
    <p className="mt-1 text-sm">Last reliable position: {time(person.captured_at)}</p>
    {person.latitude === null || person.longitude === null
      ? <p className="mt-1 text-sm text-muted-foreground">{person.last_reported_at
        ? `GPS received at ${time(person.last_reported_at)}, but no reliable map position${person.last_reported_accuracy_m === null ? '' : ` · reported ±${Math.round(person.last_reported_accuracy_m)} m`}`
        : person.status ? 'Working session recorded; waiting for the phone to send a GPS position.' : 'No on-duty position available'}</p>
      : <p className="mt-1 text-sm text-muted-foreground">Approximate location ±{Math.round(person.accuracy_m ?? 0)} m · not an exact building</p>}
    {person.captured_at && person.last_reported_at && Date.parse(person.last_reported_at) > Date.parse(person.captured_at)
      && <p className="mt-1 text-sm text-amber-700">Newer GPS at {time(person.last_reported_at)} was too imprecise or untrusted; {livePosition(person, generatedAt) ? 'pin shows the earlier reliable fix' : 'last known position uses the earlier reliable fix'}.</p>}
    <Button className="mt-3" variant="outline" onClick={() => onSelect(person.employee_id)}>View route and visits</Button>
  </article>)}</div>;
  return <section className="space-y-3" aria-label="Officer duty status">
    <div><h2 className="text-lg font-semibold">On-duty officers · {onDuty.length}</h2><p className="text-sm text-muted-foreground">Current work status · route and visits for {date}</p></div>
    {onDuty.length ? cards(onDuty) : <p className="rounded-xl border p-4">No officers are on duty.</p>}
    {!!onlineOffDuty.length && <div className="space-y-3"><h3 className="font-semibold">Online · no active work session</h3>
      <p className="text-sm text-muted-foreground">The app is connected, but the CRM has no confirmed open session. Check attendance sync on the phone if it shows working.</p>
      {cards(onlineOffDuty)}</div>}
    {!!offDuty.length && <details className="space-y-3"><summary className="cursor-pointer text-sm font-medium">Off-duty officers · {offDuty.length}</summary>{cards(offDuty)}</details>}
  </section>;
}
