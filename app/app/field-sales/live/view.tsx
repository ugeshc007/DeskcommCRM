'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { RouteMap, type Operations, type ShopCollection } from '../operations';
import { displayRoute } from '@/lib/field-sales/route-quality';
import { OfficerCards } from '../officer-cards';

function localDate(instant: string, timezone: string) {
  const parts = new Intl.DateTimeFormat('en', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(instant));
  const value = (type: string) => parts.find(part => part.type === type)?.value ?? '';
  return `${value('year')}-${value('month')}-${value('day')}`;
}

export function FieldLiveView({ organizationId, userId, initialEmployeeId, initialDate, embedded = false }: { organizationId: string; userId: string; initialEmployeeId?: string; initialDate?: string; embedded?: boolean }) {
  const [date, setDate] = useState(() => initialDate ?? new Date().toISOString().slice(0, 10));
  const [employeeId, setEmployeeId] = useState(initialEmployeeId ?? '');
  const [voiding, setVoiding] = useState<ShopCollection | null>(null);
  const [voidBusy, setVoidBusy] = useState(false), [voidError, setVoidError] = useState('');
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
  const onDuty = data?.latest.filter(person => person.status) ?? [];
  const validPoints = data?.points.filter(point => !point.mock_location) ?? [];
  const plottedRoute = displayRoute(data?.points ?? [], data?.quality);
  const time = (value: string | null) => value && timezone
    ? new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short', timeZone: timezone }).format(new Date(value)) : 'No location yet';
  const money = (value: string | null, currency: string) => value === null ? 'Not specified'
    : `${currency} ${(Math.abs(Number(value)) / 100).toFixed(2)}`;
  const selectedCollections = data?.collections.filter(item => item.employee_id === employeeId) ?? [];
  async function voidCollection(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!voiding || voidBusy) return;
    const form = new FormData(event.currentTarget), reason = String(form.get('reason') ?? '').trim();
    if (reason.length < 5) { setVoidError('Enter at least five characters explaining the correction.'); return; }
    setVoidBusy(true); setVoidError('');
    try {
      const response = await fetch('/api/v1/field-sales/customers', { method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ operation: 'void', collection_id: voiding.id, reason }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message ?? 'Correction could not be saved.');
      setVoiding(null); await query.refetch();
    } catch (error) { setVoidError(error instanceof Error ? error.message : 'Correction could not be saved.'); }
    finally { setVoidBusy(false); }
  }

  const Container = embedded ? 'section' : 'main';
  return <Container className={embedded ? 'min-w-0 space-y-5' : 'mx-auto max-w-[1600px] space-y-5 p-4 md:p-6'}>
    {!embedded && <header className="flex flex-wrap items-start justify-between gap-4">
      <div><p className="mb-1 text-sm text-muted-foreground">CRM / Field Sales</p>
        <h1 className="text-2xl font-semibold">Field team live view</h1>
        <p className="mt-2 max-w-3xl text-sm text-muted-foreground">See each on-duty officer&apos;s last reported location. Select an officer and date to review the complete recorded GPS path for that day.</p></div>
      <Button asChild variant="outline"><Link href="/app/field-sales">Back to Field Sales</Link></Button>
    </header>}
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
        <div className="rounded-xl border bg-card p-4"><strong className="text-2xl">{onDuty.length}</strong><p className="text-sm text-muted-foreground">On-duty officers</p></div>
        <div className="rounded-xl border bg-card p-4"><strong className="text-2xl">{data.latest.length}</strong><p className="text-sm text-muted-foreground">Enrolled field officers</p></div>
        <div className="rounded-xl border bg-card p-4"><strong className="text-2xl">{employeeId ? validPoints.length : '—'}</strong><p className="text-sm text-muted-foreground">Recorded GPS points for selected date</p></div>
      </div>
      {!embedded && <OfficerCards people={data.latest} timezone={data.region.timezone} date={date} generatedAt={data.generated_at} quality={data.quality} selectedEmployeeId={employeeId} onSelect={setEmployeeId}/>}
      <RouteMap data={data} selectedEmployeeId={employeeId} routeDate={date} onSelectEmployee={setEmployeeId}/>
      <p className="text-xs text-muted-foreground">Live pins require an online, on-duty phone and a reliable GPS fix within five minutes. Orange means a newer GPS report was too imprecise or untrusted. Officers without a recent reliable fix remain in the cards with their last known GPS time. The shaded circle shows reported uncertainty. The blue path is recorded GPS, not a road-routed estimate. Tracking stops at punch-out.</p>
      {employeeId && <section className="rounded-xl border bg-card p-4" aria-label="Selected officer route">
        <h2 className="font-semibold">{selected?.display_name ?? 'Selected field officer'} · {date}</h2>
        <p className="text-sm text-muted-foreground">{validPoints.length ? `${validPoints.length} recorded points · ${plottedRoute.plotted.length} quality-checked points plotted · validated travel ${(plottedRoute.distance_m / 1000).toFixed(2)} km · ${time(validPoints[0]!.captured_at)} to ${time(validPoints[validPoints.length - 1]!.captured_at)}` : 'No recorded route for this date within the retention period.'}</p>
        {plottedRoute.plotted.length > 0 && !plottedRoute.lines.length && <p className="mt-2 text-sm">Only isolated GPS fixes are available. Blue dots show recorded positions; there are not enough continuous fixes to draw a travel path.</p>}
        {!!data.points.length && !plottedRoute.plotted.length && <p className="mt-2 text-sm">The recorded fixes were too imprecise or untrusted to show a travel path. No exact building can be inferred from them.</p>}
        {!data.points.length && selected?.status && <p className="mt-2 text-sm">The work session is active, but no GPS records are available for this date. Check location and pending GPS records in the phone app’s Notifications.</p>}
        <Button className="mt-3" variant="outline" onClick={() => setEmployeeId('')}>Show all current positions</Button>
      </section>}
      {employeeId && <section className="space-y-3" aria-label="Officer activity notes">
        <h2 className="text-lg font-semibold">Activity notes · {date}</h2>
        {!data.activities.some(item => item.employee_id === employeeId) && <p className="rounded-xl border p-4 text-sm">No confirmed activity notes for this date.</p>}
        {data.activities.filter(item => item.employee_id === employeeId).map(item => <article key={item.id} className="rounded-xl border bg-card p-4">
          <p className="text-sm font-medium">{item.shop_name ?? item.project_name} · {time(item.captured_at)}</p>
          <p className="mt-1 whitespace-pre-wrap text-sm">{item.note}</p>
          <p className="mt-1 text-xs text-muted-foreground">Confirmed by the officer · {item.source === 'voice' ? 'spoken then reviewed' : 'typed'}</p>
        </article>)}
      </section>}
      {employeeId && <section className="space-y-3" aria-label="Officer shop visits and collections">
        <h2 className="text-lg font-semibold">Shop visits and collections · {date}</h2>
        <p className="text-sm text-muted-foreground">Recorded payments are money already received, not online charges. A negative remaining balance is advance credit. Shop pins appear only when a nearby, accurate GPS fix is available within the location-retention period.</p>
        {!selectedCollections.length && <p className="rounded-xl border p-4 text-sm">No shop visit or collection recorded for this officer on this date.</p>}
        <div className="grid gap-3 md:grid-cols-2">{selectedCollections.map(item => <article key={item.id} className={`rounded-xl border bg-card p-4 ${item.voided_at ? 'opacity-70' : ''}`}>
          <h3 className="font-semibold">{item.shop_name}</h3>
          <p className="text-sm text-muted-foreground">{item.project_name} · {time(item.captured_at)}</p>
          <p className="mt-2 text-sm">{item.amount_cents === null ? 'Shop visit · no amount entered' : `Received: ${money(item.amount_cents, item.currency)}`}</p>
          {item.voided_at ? <p className="text-sm text-destructive">Voided {time(item.voided_at)} · {item.void_reason}</p>
            : <p className="text-sm">{item.balance_after_cents === null ? 'Due not specified' : Number(item.balance_after_cents) < 0 ? `Advance credit: ${money(item.balance_after_cents, item.currency)}` : `Due after visit: ${money(item.balance_after_cents, item.currency)}`}</p>}
          <p className="mt-1 text-xs text-muted-foreground">{item.latitude === null ? 'No reliable shop map pin for this visit' : `Shop pin · accuracy ±${Math.round(item.accuracy_m ?? 0)} m`}</p>
          {!item.voided_at && item.employee_id !== userId && (data.role === 'admin' || data.role === 'manager') &&
            <Button className="mt-2" variant="outline" onClick={() => { setVoidError(''); setVoiding(item); }}>Correct mistaken record</Button>}
        </article>)}</div>
      </section>}
      <Dialog open={Boolean(voiding)} onOpenChange={open => { if (!open && !voidBusy) setVoiding(null); }}>
        <DialogContent><DialogHeader><DialogTitle>Void mistaken shop record?</DialogTitle>
          <DialogDescription>The original record stays in history. A payment void adds its amount back to the current due balance; later imports may require manual reconciliation.</DialogDescription>
        </DialogHeader>
          <form onSubmit={voidCollection} className="space-y-3">
            <p className="text-sm">{voiding?.shop_name} · {voiding?.amount_cents === null ? 'Visit only' : money(voiding?.amount_cents ?? null, voiding?.currency ?? '')}</p>
            <label className="grid gap-2 text-sm font-medium">Reason<Textarea name="reason" required minLength={5} maxLength={500}/></label>
            {voidError && <p role="alert" className="text-sm text-destructive">{voidError}</p>}
            <Button disabled={voidBusy}>Void and restore balance</Button>
          </form>
        </DialogContent>
      </Dialog>

    </>}
  </Container>;
}
