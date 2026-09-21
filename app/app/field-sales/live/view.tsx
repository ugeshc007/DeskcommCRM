'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { RouteMap, type Operations } from '../operations';

function localDate(instant: string, timezone: string) {
  const parts = new Intl.DateTimeFormat('en', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(instant));
  const value = (type: string) => parts.find(part => part.type === type)?.value ?? '';
  return `${value('year')}-${value('month')}-${value('day')}`;
}

export function FieldLiveView({ organizationId, userId, initialEmployeeId, initialDate }: { organizationId: string; userId: string; initialEmployeeId?: string; initialDate?: string }) {
  const [date, setDate] = useState(() => initialDate ?? new Date().toISOString().slice(0, 10));
  const [employeeId, setEmployeeId] = useState(initialEmployeeId ?? '');
  const dateTouched = useRef(Boolean(initialDate));
  const query = useQuery({
    queryKey: ['field-sales-live', organizationId, userId, date, employeeId],
    refetchInterval: 15000,
    gcTime: 0,
    queryFn: async (): Promise<Operations> => {
      const params = new URLSearchParams({ date });
      if (employeeId) params.set('employee_id', employeeId);
      const response = await fetch(`/api/v1/field-sales/operations?${params}`, { cache: 'no-store' });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message ?? 'Unable to load field locations.');
      return body.data;
    },
  });
  const data = query.data;
  const timezone = data?.region.timezone;
  const today = timezone ? localDate(data.generated_at, timezone) : date;
  useEffect(() => {
    if (!data || dateTouched.current) return;
    dateTouched.current = true;
    setDate(localDate(data.generated_at, data.region.timezone));
  }, [data]);
  const selected = data?.latest.find(person => person.employee_id === employeeId);
  const onDuty = data?.latest.filter(person => person.status && person.latitude !== null && person.longitude !== null) ?? [];
  const validPoints = data?.points.filter(point => !point.mock_location) ?? [];
  const time = (value: string | null) => value && timezone
    ? new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short', timeZone: timezone }).format(new Date(value)) : 'No location yet';

  return <main className="mx-auto max-w-[1600px] space-y-5 p-4 md:p-6">
    <header className="flex flex-wrap items-start justify-between gap-4">
      <div><p className="mb-1 text-sm text-muted-foreground">CRM / Field Sales</p>
        <h1 className="text-2xl font-semibold">Field team live view</h1>
        <p className="mt-2 max-w-3xl text-sm text-muted-foreground">See each on-duty officer&apos;s last reported location. Select an officer and date to review the complete recorded GPS path for that day.</p></div>
      <Button asChild variant="outline"><Link href="/app/field-sales">Back to Field Sales</Link></Button>
    </header>
    <section className="flex flex-wrap items-end gap-3 rounded-xl border bg-card p-4" aria-label="Map filters">
      <label className="grid gap-2 text-sm font-medium">Travel date
        <Input type="date" value={date} onChange={event => { if (event.target.value) { dateTouched.current = true; setDate(event.target.value); } }}/>
      </label>
      <Button variant="outline" onClick={() => setDate(today)}>Today</Button>
      <label className="grid min-w-56 gap-2 text-sm font-medium">Field officer
        <select className="h-10 rounded-md border bg-background px-3" value={employeeId} onChange={event => setEmployeeId(event.target.value)}>
          <option value="">All current positions</option>
          {data?.latest.map(person => <option value={person.employee_id} key={person.employee_id}>{person.display_name}</option>)}
        </select>
      </label>
      <Button variant="outline" onClick={() => void query.refetch()} disabled={query.isFetching}>Refresh locations</Button>
      {timezone && <p className="pb-2 text-xs text-muted-foreground">Dates and times use {timezone}.</p>}
    </section>
    {query.isPending && <p role="status">Loading field locations…</p>}
    {query.error && <p role="alert" className="rounded-lg border border-destructive p-3">{query.error.message}</p>}
    {data && <>
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl border bg-card p-4"><strong className="text-2xl">{onDuty.length}</strong><p className="text-sm text-muted-foreground">On-duty officers with a reported position</p></div>
        <div className="rounded-xl border bg-card p-4"><strong className="text-2xl">{data.latest.length}</strong><p className="text-sm text-muted-foreground">Enrolled field officers</p></div>
        <div className="rounded-xl border bg-card p-4"><strong className="text-2xl">{employeeId ? validPoints.length : '—'}</strong><p className="text-sm text-muted-foreground">Recorded GPS points for selected date</p></div>
      </div>
      <RouteMap data={data} selectedEmployeeId={employeeId} routeDate={date} onSelectEmployee={setEmployeeId}/>
      <p className="text-xs text-muted-foreground">Pins show the last reported on-duty position, not a continuously measured position. The blue path is recorded GPS, not a road-routed estimate. Tracking stops at punch-out.</p>
      {employeeId && <section className="rounded-xl border bg-card p-4" aria-label="Selected officer route">
        <h2 className="font-semibold">{selected?.display_name ?? 'Selected field officer'} · {date}</h2>
        <p className="text-sm text-muted-foreground">{validPoints.length ? `${validPoints.length} recorded points · ${time(validPoints[0]!.captured_at)} to ${time(validPoints[validPoints.length - 1]!.captured_at)}` : 'No recorded route for this date within the retention period.'}</p>
        <Button className="mt-3" variant="outline" onClick={() => setEmployeeId('')}>Show all current positions</Button>
      </section>}
      <section className="space-y-3"><h2 className="text-lg font-semibold">Field officers</h2>
        {!data.latest.length && <p className="rounded-xl border p-4">No field officers enrolled yet. Enroll staff under Field Sales → Team.</p>}
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{data.latest.map(person => <article className={`rounded-xl border bg-card p-4 ${employeeId === person.employee_id ? 'border-primary' : ''}`} key={person.employee_id}>
          <h3 className="font-semibold">{person.display_name}</h3>
          <p className="text-sm">{person.status?.replaceAll('_', ' ') ?? 'Off duty'}</p>
          <p className="text-sm text-muted-foreground">Last reported: {time(person.captured_at)}</p>
          {person.mock_location && <p className="text-sm text-amber-700">Mock location flagged</p>}
          <Button className="mt-3" variant="outline" onClick={() => setEmployeeId(person.employee_id)}>View travel path for {date}</Button>
        </article>)}</div>
      </section>
    </>}
  </main>;
}
