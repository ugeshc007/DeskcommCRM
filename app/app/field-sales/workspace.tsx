'use client';

import Link from 'next/link';
import { cloneElement, useEffect, useId, useRef, useState, type FormEvent, type ReactElement } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarBlank, Buildings, Users, Plus, CaretLeft, ArrowRight } from '@/lib/ui/icons';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { addCalendarDays, mondayOfWeek } from '@/lib/field-sales/schedule';
import { FieldOperations, type ShopCollection } from './operations';
import type { FieldSchedule } from '@/lib/field-sales/contracts';
import { useT } from '@/hooks/i18n/useT';

type Employee = { user_id: string; display_name: string; active: boolean };
type Project = { id: string; name: string; site_name: string; active: boolean };
type Occurrence = { occurrence_key: string; employee_id: string; date: string; starts_at: string; ends_at: string;
  employee_name: string; project_name: string; site_name: string; revision: number; schedule: FieldSchedule; timezone: string; untimed: boolean };
type Assignment = { id: string; employee_id: string; project_id: string; project_name: string; employee_name: string;
  revision: number; schedule: FieldSchedule };
type CalendarData = { installed: boolean; role?: 'field_officer' | 'agent' | 'manager' | 'admin';
  region?: { country_code: string; timezone: string } | null;
  settings?: { revision: number; enabled: boolean; retention_days: number; notice_text: string } | null;
  employees?: Employee[]; projects?: Project[]; occurrences?: Occurrence[]; assignments?: Assignment[];
  overlaps?: Array<[string, string]>; warnings?: Array<{ schedule_id: string; reason: string }> };
type Member = { user_id: string; full_name: string | null; role: string };
type TeamPresence = { generated_at: string; region: { timezone: string }; latest: Array<{ employee_id: string; status: string | null; captured_at: string | null; latitude: number | null; longitude: number | null; online: boolean; last_seen_at: string | null }>;
  sessions: Array<{ employee_id: string; punched_in_at: string; punched_out_at: string | null }>;
  collections: ShopCollection[] };
const selectClass = 'h-11 w-full min-w-0 rounded-md border border-input bg-background px-3 text-sm';

function dateInZone(instant: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat('en', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(instant);
  const part = (type: string) => parts.find(item => item.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

function Field({ label, children }: { label: string; children: ReactElement<{ id?: string }> }) {
  const generated = useId(), id = children.props.id ?? generated;
  return <div className="grid min-w-0 gap-2 text-sm font-medium"><label htmlFor={id}>{label}</label>{cloneElement(children, { id })}</div>;
}
async function readJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { cache: 'no-store' });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error?.message ?? 'Unable to load data.');
  return body.data as T;
}

export function FieldSalesWorkspace({ organizationId, userId }: { organizationId: string; userId: string }) {
  const t = useT();
  const cache = useQueryClient();
  const [start, setStart] = useState(() => mondayOfWeek(new Date().toISOString().slice(0, 10)));
  const calendarInitialized = useRef(false);
  const [view, setView] = useState<'day' | 'week'>('week');
  const [dialog, setDialog] = useState<'project' | 'schedule' | 'employee' | 'manage' | 'customers' | null>(null);
  const [customerProjectId, setCustomerProjectId] = useState<string | null>(null);
  const [managedEmployeeId, setManagedEmployeeId] = useState<string | null>(null);
  const [managedProjectId, setManagedProjectId] = useState<string | null>(null);
  const [editingAssignment, setEditingAssignment] = useState<Assignment | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState('');
  const [employeeFilter, setEmployeeFilter] = useState('all');
  const [activeTab, setActiveTab] = useState('calendar');
  const [editing, setEditing] = useState<Occurrence | null>(null);
  const [editScope, setEditScope] = useState<'one' | 'future'>('one');
  const [draftId, setDraftId] = useState(() => crypto.randomUUID());
  const end = addCalendarDays(start, view === 'week' ? 6 : 0);
  const query = useQuery({ queryKey: ['field-sales', organizationId, userId, start, end], queryFn: () => readJson<CalendarData>(`/api/v1/field-sales?from=${start}&through=${end}`), gcTime: 0 });
  const data = query.data;
  const members = useQuery({ queryKey: ['field-sales-members', organizationId, userId], queryFn: () => readJson<Member[]>('/api/v1/team/assignable'), enabled: data?.role === 'admin', gcTime: 0 });
  const manager = data?.role === 'admin' || data?.role === 'manager';
  const administrator = data?.role === 'admin';
  const timezone = data?.region?.timezone;
  const teamDate = timezone ? dateInZone(new Date(), timezone) : start;
  const teamPresence = useQuery({ queryKey: ['field-sales-team-presence', organizationId, userId, teamDate],
    queryFn: () => readJson<TeamPresence>(`/api/v1/field-sales/operations?date=${teamDate}`),
    enabled: data?.installed === true && activeTab === 'team', refetchInterval: 15000, gcTime: 0 });
  const customerRoster = useQuery({ queryKey: ['field-sales-customers', organizationId, customerProjectId],
    queryFn: () => readJson<Array<{ id: string; customer_code: string; shop_name: string; address: string; balance_cents: string | null; currency: string }>>(`/api/v1/field-sales/customers?project_id=${customerProjectId}`),
    enabled: dialog === 'customers' && Boolean(customerProjectId), gcTime: 0 });
  const formatTime = (instant: string | null | undefined) => instant && timezone
    ? new Intl.DateTimeFormat('en', { hour: '2-digit', minute: '2-digit', timeZone: timezone }).format(new Date(instant)) : '—';
  useEffect(() => {
    if (!timezone || calendarInitialized.current) return;
    calendarInitialized.current = true;
    const parts = new Intl.DateTimeFormat('en', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
    const part = (type: string) => parts.find(item => item.type === type)?.value ?? '';
    setStart(mondayOfWeek(`${part('year')}-${part('month')}-${part('day')}`));
  }, [timezone]);
  const days = Array.from({ length: view === 'week' ? 7 : 1 }, (_, i) => addCalendarDays(start, i));
  const people = data?.employees ?? [], projects = data?.projects ?? [];
  const clashes = new Set((data?.overlaps ?? []).flat());

  async function save(input: unknown, closeDialog = true): Promise<boolean> {
    if (busy) return false;
    setBusy(true); setError(''); setMessage('');
    try {
      const response = await fetch('/api/v1/field-sales', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message ?? 'Changes could not be saved.');
      await cache.invalidateQueries({ queryKey: ['field-sales'] });
      if (closeDialog) setDialog(null);
      setMessage('Saved. The calendar has been refreshed.');
      return true;
    } catch (e) { setError(e instanceof Error ? e.message : 'Changes could not be saved.'); return false; }
    finally { setBusy(false); }
  }
  function submitProject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    const text = (key: string) => String(form.get(key) ?? '');
    void save({ operation: 'project', id: crypto.randomUUID(), revision: 0, project: {
      name: text('name'), site_name: text('site'), customer_id: null, address: text('address'),
      latitude: text('latitude') ? Number(text('latitude')) : null,
      longitude: text('longitude') ? Number(text('longitude')) : null,
      instructions: text('instructions'), active: true,
    } });
  }
  function submitSchedule(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    const text = (key: string) => String(form.get(key) ?? '');
    const weekdays = editing && editScope === 'one' ? [] : form.getAll('weekday').map(Number);
    const parts = new Intl.DateTimeFormat('en', { timeZone: timezone ?? 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
    const part = (type: string) => parts.find(item => item.type === type)?.value ?? '';
    const today = `${part('year')}-${part('month')}-${part('day')}`;
    const schedule = {
      project_id: text('project'), employee_id: text('employee'), start_date: editing?.date ?? (text('start_date') || today),
      end_date: editing && editScope === 'one' ? null : text('end_date') || null, start_time: text('start_time') || null, end_time: text('end_time') || null,
      end_day_offset: form.has('overnight') ? 1 : 0, repeat: weekdays.length ? 'weekly' : 'once',
      weekdays, instructions: text('instructions'),
    };
    void save(editing ? { operation: 'reschedule', id: editing.occurrence_key.split(':')[0], revision: editing.revision,
      new_id: draftId, date: editing.date, scope: editScope, schedule } : { operation: 'schedule', id: draftId, revision: 0, schedule });
  }
  function submitManagedAssignment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!managedEmployeeId || !managedProjectId) return;
    const form = new FormData(event.currentTarget);
    const weekdays = form.getAll('weekday').map(Number);
    const effectiveDate = String(form.get('effective_date') || teamDate);
    const schedule = { project_id: managedProjectId, employee_id: managedEmployeeId,
      start_date: effectiveDate, end_date: String(form.get('end_date') || '') || null,
      start_time: null, end_time: null, end_day_offset: 0, repeat: 'weekly' as const,
      weekdays, instructions: String(form.get('instructions') || '') };
    if (!weekdays.length) { setError('Choose at least one weekday.'); return; }
    void save(editingAssignment
      ? { operation: 'replace_schedule', id: editingAssignment.id, revision: editingAssignment.revision,
        new_id: crypto.randomUUID(), effective_date: effectiveDate, schedule }
      : { operation: 'schedule', id: crypto.randomUUID(), revision: 0, schedule }, false)
      .then(saved => { if (saved) { setManagedProjectId(null); setEditingAssignment(null); } });
  }
  async function saveCustomers(body: BodyInit, contentType?: string) {
    if (busy) return;
    setBusy(true); setError(''); setMessage('');
    try {
      const response = await fetch('/api/v1/field-sales/customers', { method: 'POST',
        headers: contentType ? { 'Content-Type': contentType } : undefined, body });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error?.message ?? 'Shops could not be saved.');
      await cache.invalidateQueries({ queryKey: ['field-sales-customers', organizationId, customerProjectId] });
      setMessage(`${result.data.saved} shop(s) saved. Imported due amounts replace the current balance for matching codes.`);
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Shops could not be saved.'); }
    finally { setBusy(false); }
  }
  return <main className="mx-auto max-w-[1600px] space-y-6 p-4 md:p-6">
    <header className="flex flex-wrap items-start justify-between gap-4">
      <div><p className="mb-1 text-sm text-muted-foreground">CRM / Field operations</p>
        <h1 className="text-2xl font-semibold">Field Sales</h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">Plan project visits, coordinate your team and review on-duty activity.</p></div>
      <div className="flex flex-wrap gap-2">
        {administrator && <Button asChild variant="outline"><Link href="/app/field-sales/live">Open live map</Link></Button>}
        {manager && <Button onClick={() => { setError(''); setEditing(null); setDraftId(crypto.randomUUID()); setDialog('schedule'); }} disabled={!people.some(e => e.active) || !projects.some(p => p.active) || !timezone}><Plus aria-hidden />Assign project</Button>}
      </div>
    </header>
    {(error || query.error) && <p role="alert" className="rounded-lg border border-destructive p-3">{error || query.error?.message} <Button variant="outline" onClick={() => void query.refetch()}>Retry</Button></p>}
    {message && <p role="status" className="rounded-lg border p-3">{message}</p>}
    {query.isPending && <p role="status">Loading field workspace…</p>}
    {data && !data.installed && <section className="rounded-xl border p-6"><h2 className="font-semibold">Install the Field Sales module first</h2>
      <p className="mt-2 text-sm text-muted-foreground">An installation administrator must install this optional module. Installation does not enroll staff or enable tracking.</p></section>}
    {data?.installed && <>
      <section className="grid gap-3 sm:grid-cols-3" aria-label="Workspace overview">
        <div className="rounded-xl border bg-card p-4"><Users aria-hidden className="mb-2 size-5"/><strong>{people.filter(e => e.active).length} enrolled staff</strong><p className="text-sm text-muted-foreground">Only your authorized team</p></div>
        <div className="rounded-xl border bg-card p-4"><Buildings aria-hidden className="mb-2 size-5"/><strong>{projects.filter(p => p.active).length} active projects</strong><p className="text-sm text-muted-foreground">Separate sites and assignments</p></div>
        <div className="rounded-xl border bg-card p-4"><CalendarBlank aria-hidden className="mb-2 size-5"/><strong>{data.region?.country_code ?? 'Country required'} · {timezone ?? 'Time zone required'}</strong><p className="text-sm text-muted-foreground">{t('Inherited from CRM organization settings')}</p></div>
      </section>
      {!timezone && <p role="alert" className="rounded-lg border p-4">Configure the organization country and time zone before scheduling.</p>}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="flex h-auto flex-wrap justify-start"><TabsTrigger value="calendar">Calendar</TabsTrigger><TabsTrigger value="activity">Live view</TabsTrigger><TabsTrigger value="projects">Projects</TabsTrigger><TabsTrigger value="team">Team</TabsTrigger>{administrator && <TabsTrigger value="policy">Tracking policy</TabsTrigger>}</TabsList>
        <TabsContent value="activity"><FieldOperations organizationId={organizationId} userId={userId} date={start}/></TabsContent>
        <TabsContent value="calendar" className="space-y-4">
          <div className="flex flex-wrap items-end gap-3">
            <Button variant="outline" aria-label="Previous period" onClick={() => setStart(addCalendarDays(start, view === 'week' ? -7 : -1))}><CaretLeft aria-hidden/></Button>
            <Field label={view === 'week' ? 'Week of' : 'Date'}><Input type="date" value={start} onChange={e => { if (e.target.value) setStart(view === 'week' ? mondayOfWeek(e.target.value) : e.target.value); }}/></Field>
            <Button variant="outline" aria-label="Next period" onClick={() => setStart(addCalendarDays(start, view === 'week' ? 7 : 1))}><ArrowRight aria-hidden/></Button>
            <Field label="Calendar view"><select className={selectClass} value={view} onChange={e => { const next = e.target.value as 'day' | 'week'; setView(next); if (next === 'week') setStart(mondayOfWeek(start)); }}><option value="day">Day</option><option value="week">Week</option></select></Field>
            <Field label="Salesperson"><select className={selectClass} value={employeeFilter} onChange={e => setEmployeeFilter(e.target.value)}><option value="all">All authorized staff</option>{people.map(e => <option key={e.user_id} value={e.user_id}>{e.display_name}</option>)}</select></Field>
          </div>
          {!!data.overlaps?.length && <p role="alert" className="rounded-lg border p-3">{data.overlaps.length} overlapping assignment pair(s). Review the highlighted visits before notifying staff.</p>}
          {data.warnings?.map(w => <p role="alert" key={w.schedule_id}>{w.reason}</p>)}
          <div className="overflow-x-auto rounded-xl border bg-card" aria-label="Field officer weekly project assignments">
            <table className="w-full min-w-[760px] border-collapse text-left text-sm"><thead><tr className="border-b bg-muted/40"><th scope="col" className="min-w-36 p-3">Field officer</th>
              {days.map(date => <th scope="col" key={date} className="min-w-40 border-l p-3">{new Intl.DateTimeFormat('en', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(date + 'T00:00:00Z'))}</th>)}</tr></thead>
              <tbody>{people.filter(person => employeeFilter === 'all' || person.user_id === employeeFilter).map(person => <tr key={person.user_id} className="border-b align-top last:border-b-0"><th scope="row" className="p-3 font-medium">{person.display_name}</th>
                {days.map(date => { const assignments = (data.occurrences ?? []).filter(o => o.date === date && o.employee_id === person.user_id);
                  return <td key={date} className="border-l p-2">{assignments.length ? <div className="space-y-2">{assignments.map(o => <article key={o.occurrence_key} className={`rounded-md border-l-4 p-2 ${clashes.has(o.occurrence_key) ? 'border-destructive bg-muted' : 'border-primary bg-muted/40'}`}>
                    <p className="font-medium">{o.project_name}</p><p className="text-xs text-muted-foreground">{o.untimed ? 'Any time' : `${formatTime(o.starts_at)} – ${formatTime(o.ends_at)}`}</p>
                    {manager && Date.parse(o.starts_at) > Date.now() && <div className="mt-2 flex flex-wrap gap-1"><Button variant="outline" size="sm" disabled={busy} onClick={() => { setError(''); setEditing(o); setEditScope('one'); setDraftId(crypto.randomUUID()); setDialog('schedule'); }}>Change date</Button>
                      <Button variant="ghost" size="sm" disabled={busy} onClick={() => { if (window.confirm('Cancel only this date? The recurring project assignment and history remain.')) void save({ operation: 'cancel_occurrence', id: o.occurrence_key.split(':')[0], revision: o.revision, date: o.date }); }}>Cancel date</Button></div>}
                  </article>)}</div> : <span className="text-muted-foreground">—</span>}</td>; })}</tr>)}
              </tbody></table>
            {!people.length && <p className="p-4 text-sm text-muted-foreground">Enroll field officers to plan their weekly projects.</p>}
          </div>
        </TabsContent>
        <TabsContent value="projects" className="space-y-4">{administrator && <Button variant="outline" onClick={() => setDialog('project')}><Plus aria-hidden/>New project</Button>}
          {!projects.length && <p className="rounded-xl border p-6">No projects yet. Add a project and its site, then assign a calendar visit.</p>}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{projects.map(p => <article key={p.id} className="rounded-xl border p-5"><h2 className="font-semibold">{p.name}</h2><p>{p.site_name}</p><p className="text-sm text-muted-foreground">{p.active ? 'Active' : 'Archived'}</p>
            {manager && <Button className="mt-3" variant="outline" onClick={() => { setError(''); setCustomerProjectId(p.id); setDialog('customers'); }}>Manage shops and due</Button>}</article>)}</div>
        </TabsContent>
        <TabsContent value="team" className="space-y-4">{administrator && <Button variant="outline" onClick={() => setDialog('employee')}><Plus aria-hidden/>Enroll salesperson</Button>}
          <p className="text-sm text-muted-foreground">Enrollment does not start tracking. Staff must punch in from their authorized Android app.</p>
          <section className="space-y-3" aria-label="Field officer attendance">
            <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="font-semibold">Field officers · {teamDate}</h2><span className="text-xs text-muted-foreground">Refreshes every 15 seconds · {timezone}</span></div>
            {teamPresence.isPending && <p role="status">Loading team attendance…</p>}
            {teamPresence.error && <p role="alert">{teamPresence.error.message} <Button variant="outline" onClick={() => void teamPresence.refetch()}>Retry</Button></p>}
            {!people.length && <p className="rounded-xl border p-4">No field officers enrolled yet.</p>}
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{people.map(person => {
              const position = teamPresence.data?.latest.find(item => item.employee_id === person.user_id);
              const sessions = teamPresence.data?.sessions.filter(item => item.employee_id === person.user_id) ?? [];
              const openSession = sessions.find(item => !item.punched_out_at);
              const lastSession = openSession ?? sessions[0];
              const latestShop = teamPresence.data?.collections.find(item => item.employee_id === person.user_id && !item.voided_at);
              const present = person.active && Boolean(openSession && position?.status);
              return <article className="rounded-xl border bg-card p-4" key={person.user_id}>
                <div className="flex flex-wrap items-start justify-between gap-2"><h3 className="font-semibold">{person.display_name}</h3><div className="flex flex-wrap gap-1"><span className={`rounded-full px-2 py-1 text-xs font-medium ${position?.online ? 'bg-sky-100 text-sky-900' : 'bg-muted text-muted-foreground'}`}>{position?.online ? 'Online' : 'Offline'}</span><span className={`rounded-full px-2 py-1 text-xs font-medium ${present ? 'bg-emerald-100 text-emerald-900' : 'bg-muted text-muted-foreground'}`}>{!person.active ? 'Inactive' : present ? position?.status === 'break' ? 'Present · on break' : 'Present' : 'Absent / off duty'}</span></div></div>
                <dl className="mt-3 grid grid-cols-2 gap-2 text-sm"><div><dt className="text-muted-foreground">Punched in</dt><dd>{formatTime(lastSession?.punched_in_at)}</dd></div><div><dt className="text-muted-foreground">Punched out</dt><dd>{formatTime(lastSession?.punched_out_at)}</dd></div></dl>
                <p className="mt-3 text-xs text-muted-foreground">Last position: {position?.latitude !== null && position?.longitude !== null && position?.captured_at ? formatTime(position.captured_at) : 'Not reported'}</p>
                <p className="mt-1 text-xs text-muted-foreground">App last checked in: {formatTime(position?.last_seen_at)}</p>
                <p className="mt-2 text-sm">{latestShop ? `Latest shop: ${latestShop.shop_name} · ${formatTime(latestShop.captured_at)}${latestShop.amount_cents === null ? ' · visit only' : ` · received ${latestShop.currency} ${(Number(latestShop.amount_cents) / 100).toFixed(2)}`}` : 'No shop visits recorded today'}</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {manager && <Button asChild variant="outline"><Link href={`/app/field-sales/live?employee_id=${encodeURIComponent(person.user_id)}&date=${teamDate}`}>View route and visits</Link></Button>}
                  {manager && <Button variant="outline" onClick={() => { setError(''); setManagedEmployeeId(person.user_id); setManagedProjectId(null); setEditingAssignment(null); setDialog('manage'); }}>Manage projects</Button>}
                </div>
                <p className="mt-3 text-xs text-muted-foreground">{(data.assignments ?? []).filter(a => a.employee_id === person.user_id && (!a.schedule.end_date || a.schedule.end_date >= teamDate)).length} project assignment(s)</p>
              </article>;
            })}</div>
          </section>
        </TabsContent>
        {administrator && <TabsContent value="policy"><form key={data.settings?.revision ?? 0} className="max-w-2xl space-y-4 rounded-xl border p-5" onSubmit={event => {
          event.preventDefault(); const f = new FormData(event.currentTarget); void save({ operation: 'settings', revision: data.settings?.revision ?? 0,
            enabled: f.has('enabled'), retention_days: Number(f.get('retention')), notice_text: String(f.get('notice') ?? '') });
        }}><h2 className="text-lg font-semibold">On-duty location policy</h2>
          <p className="text-sm text-muted-foreground">GPS continues during declared breaks and stops at punch-out. No tracking starts just because a project is assigned.</p>
          <Field label="Employee notice"><Textarea name="notice" required maxLength={8000} defaultValue={data.settings?.notice_text ?? ''} placeholder="Explain who can view location, when tracking runs and how employees can raise concerns."/></Field>
          <Field label="Raw location retention (days)"><Input name="retention" type="number" min={1} max={365} required defaultValue={data.settings?.retention_days}/></Field>
          <label className="flex items-start gap-2"><input name="enabled" type="checkbox" defaultChecked={data.settings?.enabled ?? false} disabled={!timezone}/>Enable collection for enrolled staff after punch-in</label>
          <Button disabled={busy || !timezone}>Save policy</Button>
        </form></TabsContent>}
      </Tabs>
    </>}
    <Dialog open={dialog !== null} onOpenChange={open => { if (!open) setDialog(null); }}><DialogContent className="max-h-[85vh] overflow-y-auto"><DialogHeader><DialogTitle>{dialog === 'project' ? 'New project' : dialog === 'employee' ? 'Enroll salesperson' : dialog === 'manage' ? `Projects for ${people.find(p => p.user_id === managedEmployeeId)?.display_name ?? 'field officer'}` : dialog === 'customers' ? `Shops · ${projects.find(p => p.id === customerProjectId)?.name ?? 'project'}` : 'Assign project'}</DialogTitle></DialogHeader>
      {error && <p role="alert">{error}</p>}
      {dialog === 'customers' && customerProjectId && <div className="space-y-4">
        <p className="text-sm text-muted-foreground">The optional due balance uses your CRM currency. A negative balance is advance credit. A new CSV import replaces balances for matching shop codes; past collection records remain unchanged.</p>
        {message && <p role="status" className="text-sm">{message}</p>}
        <form className="space-y-3 rounded-lg border p-3" onSubmit={event => { event.preventDefault(); const form = new FormData(event.currentTarget);
          const amount = String(form.get('due') ?? '').trim();
          if (amount && !/^-?\d{1,10}(?:\.\d{1,2})?$/.test(amount)) { setError('Enter a plain amount with up to two decimal places.'); return; }
          const balance = amount ? Math.round(Number(amount) * 100) : null;
          void saveCustomers(JSON.stringify({ operation: 'add', project_id: customerProjectId,
            customer: { customer_code: String(form.get('code') || `manual-${crypto.randomUUID()}`).trim(),
              shop_name: String(form.get('shop') || '').trim(), address: String(form.get('address') || '').trim(), balance_cents: balance } }), 'application/json'); }}>
          <h3 className="font-medium">Add one shop</h3><Field label="Shop name"><Input name="shop" required maxLength={200}/></Field>
          <Field label="Shop code (optional)"><Input name="code" maxLength={100}/></Field>
          <Field label="Address (optional)"><Input name="address" maxLength={1000}/></Field>
          <Field label="Current due amount (optional)"><Input name="due" inputMode="decimal" placeholder="125.50"/></Field>
          <Button disabled={busy}>Save shop</Button>
        </form>
        <form className="space-y-2 rounded-lg border p-3" onSubmit={event => { event.preventDefault(); const form = new FormData(event.currentTarget);
          form.set('project_id', customerProjectId); void saveCustomers(form); }}>
          <h3 className="font-medium">Bulk upload CSV</h3><p className="text-xs text-muted-foreground">Columns: customer_code,shop_name,address,due_amount. Maximum 500 shops per file.</p>
          <Input type="file" name="file" accept=".csv,text/csv" required/><Button variant="outline" disabled={busy}>Upload shops</Button>
        </form>
        <div className="max-h-60 space-y-2 overflow-y-auto"><h3 className="font-medium">Project customers</h3>
          {customerRoster.isPending && <p>Loading shops…</p>}{customerRoster.error && <p role="alert">{customerRoster.error.message}</p>}
          {!customerRoster.data?.length && !customerRoster.isPending && <p className="text-sm text-muted-foreground">No shops added yet.</p>}
          {customerRoster.data?.map(customer => <div key={customer.id} className="rounded-lg border p-2 text-sm"><strong>{customer.shop_name}</strong> · {customer.customer_code}
            <p className="text-muted-foreground">{customer.balance_cents === null ? 'Due not specified' : Number(customer.balance_cents) < 0 ? `Advance credit: ${customer.currency} ${(Math.abs(Number(customer.balance_cents)) / 100).toFixed(2)}` : `Due: ${customer.currency} ${(Number(customer.balance_cents) / 100).toFixed(2)}`}</p></div>)}
        </div>
      </div>}
      {dialog === 'manage' && <div className="space-y-4">
        <p className="text-sm text-muted-foreground">Assign a project to make it available in this officer’s app. Select the weekdays when it is scheduled; the officer may choose another assigned project. No fixed working hours are imposed.</p>
        {projects.filter(p => p.active).map(project => {
          const rules = (data?.assignments ?? []).filter(a => a.employee_id === managedEmployeeId && a.project_id === project.id && (!a.schedule.end_date || a.schedule.end_date >= teamDate));
          return <section key={project.id} className="rounded-lg border p-3"><div className="flex items-center justify-between gap-2"><h3 className="font-medium">{project.name}</h3>
            <Button type="button" variant="outline" size="sm" onClick={() => { setError(''); setEditingAssignment(null); setManagedProjectId(project.id); }}>Assign weekdays</Button></div>
            {rules.length ? rules.map(rule => <div key={rule.id} className="mt-3 rounded-md bg-muted p-3 text-sm">
              <p>{rule.schedule.repeat === 'weekly' ? rule.schedule.weekdays.map(day => ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][day - 1]).join(', ') : `Only ${rule.schedule.start_date}`}</p>
              <p className="text-xs text-muted-foreground">From {rule.schedule.start_date}{rule.schedule.end_date ? ` until ${rule.schedule.end_date}` : ' · repeats weekly'}</p>
              <div className="mt-2 flex flex-wrap gap-2"><Button type="button" variant="outline" size="sm" onClick={() => { setError(''); setEditingAssignment(rule); setManagedProjectId(project.id); }}>Change future</Button>
                <form onSubmit={event => { event.preventDefault(); const date = String(new FormData(event.currentTarget).get('effective_date'));
                  if (window.confirm(`End this assignment from ${date}? Earlier visits and routes stay saved.`)) void save({ operation: 'end_schedule', id: rule.id, revision: rule.revision, effective_date: date }, false); }} className="flex flex-wrap items-center gap-2">
                  <Input name="effective_date" type="date" aria-label={`End ${project.name} from date`} min={teamDate} defaultValue={addCalendarDays(teamDate, 1)} required className="w-auto"/>
                  <Button size="sm" variant="outline" disabled={busy}>End assignment</Button>
                </form></div></div>) : <p className="mt-2 text-xs text-muted-foreground">Not assigned</p>}
          </section>;
        })}
        {managedProjectId && <form key={`${managedProjectId}:${editingAssignment?.id ?? 'new'}`} onSubmit={submitManagedAssignment} className="space-y-3 rounded-lg border p-3">
          <h3 className="font-medium">{editingAssignment ? 'Change future weekdays' : 'Assign'} · {projects.find(p => p.id === managedProjectId)?.name}</h3>
          <Field label={editingAssignment ? 'Change from date' : 'Start date'}><Input name="effective_date" type="date" min={teamDate} required defaultValue={editingAssignment ? addCalendarDays(teamDate, 1) : teamDate}/></Field>
          <Field label="Repeat until (optional)"><Input name="end_date" type="date" defaultValue={editingAssignment?.schedule.end_date ?? ''}/></Field>
          <fieldset><legend className="text-sm font-medium">Repeat weekly on</legend><div className="mt-2 flex flex-wrap gap-3">{['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((day, i) => <label key={day} className="flex min-h-11 items-center gap-1"><input type="checkbox" name="weekday" value={i + 1} defaultChecked={editingAssignment?.schedule.weekdays.includes(i + 1)}/>{day}</label>)}</div></fieldset>
          <Field label="Instructions (optional)"><Textarea name="instructions" maxLength={4000} defaultValue={editingAssignment?.schedule.instructions ?? ''}/></Field>
          <div className="flex gap-2"><Button disabled={busy}>Save weekdays</Button><Button type="button" variant="ghost" onClick={() => { setManagedProjectId(null); setEditingAssignment(null); }}>Cancel</Button></div>
        </form>}
      </div>}
      {dialog === 'project' && <form className="space-y-4" onSubmit={submitProject}>
        <Field label="Project name"><Input name="name" required maxLength={160}/></Field><Field label="Site name"><Input name="site" required maxLength={160}/></Field><Field label="Address"><Textarea name="address" maxLength={1000}/></Field>
        <div className="grid grid-cols-2 gap-3"><Field label="Latitude (optional)"><Input name="latitude" type="number" step="any" min={-90} max={90}/></Field><Field label="Longitude (optional)"><Input name="longitude" type="number" step="any" min={-180} max={180}/></Field></div>
        <Field label="Instructions"><Textarea name="instructions" maxLength={4000}/></Field><Button disabled={busy}>Save project</Button>
      </form>}
      {dialog === 'employee' && <form className="space-y-4" onSubmit={event => { event.preventDefault(); const form = new FormData(event.currentTarget); void save({ operation: 'employee', user_id: String(form.get('user')), display_name: String(form.get('name')), active: true }); }}>
        <Field label="CRM team member"><select name="user" required className={selectClass}><option value="">Choose a member</option>{(members.data ?? []).map(m => <option key={m.user_id} value={m.user_id}>{m.full_name ?? 'Unnamed team member'} ({m.role})</option>)}</select></Field>
        <Field label="Salesperson display name"><Input name="name" required maxLength={160}/></Field><Button disabled={busy}>Enroll salesperson</Button>
      </form>}
      {dialog === 'schedule' && <form className="space-y-4" onSubmit={submitSchedule}>
        <p className="text-sm text-muted-foreground">Times use {editing?.timezone ?? timezone}. Choose weekdays for a weekly assignment. Leave the date blank to start today and both times blank for an any-time visit.</p>
        {editing && <Field label="Apply changes to"><select className={selectClass} value={editScope} onChange={event => setEditScope(event.target.value as 'one' | 'future')}><option value="one">Only this visit</option><option value="future">This visit and all following visits</option></select></Field>}
        <Field label="Project"><select name="project" required className={selectClass} defaultValue={editing?.schedule.project_id ?? ''}><option value="">Choose a project</option>{projects.filter(p => p.active).map(p => <option key={p.id} value={p.id}>{p.name} — {p.site_name}</option>)}</select></Field>
        <Field label="Salesperson"><select name="employee" required className={selectClass} defaultValue={editing?.employee_id ?? ''}><option value="">Choose a salesperson</option>{people.filter(p => p.active).map(p => <option key={p.user_id} value={p.user_id}>{p.display_name}</option>)}</select></Field>
        <div className="grid grid-cols-2 gap-3"><Field label="Start date (optional)"><Input name="start_date" type="date" defaultValue={editing?.date ?? ''} readOnly={!!editing}/></Field><Field label="Repeat until (optional)"><Input name="end_date" type="date" defaultValue={editing?.schedule.end_date ?? ''} disabled={!!editing && editScope === 'one'}/></Field>
          <Field label="Start time (optional)"><Input name="start_time" type="time" defaultValue={editing?.schedule.start_time ?? ''}/></Field><Field label="End time (optional)"><Input name="end_time" type="time" defaultValue={editing?.schedule.end_time ?? ''}/></Field></div>
        <label className="flex gap-2"><input type="checkbox" name="overnight" defaultChecked={editing?.schedule.end_day_offset === 1}/>Ends on the following day</label>
        <fieldset disabled={!!editing && editScope === 'one'}><legend className="mb-2 text-sm font-medium">Repeat weekly on</legend><div className="flex flex-wrap gap-3">{['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((day, i) => <label key={day} className="flex min-h-11 items-center gap-1"><input type="checkbox" name="weekday" value={i + 1} defaultChecked={editing?.schedule.weekdays.includes(i + 1)}/>{day}</label>)}</div></fieldset>
        <Field label="Visit instructions"><Textarea name="instructions" maxLength={4000} defaultValue={editing?.schedule.instructions}/></Field><Button disabled={busy}>Save assignment</Button>
      </form>}
    </DialogContent></Dialog>
  </main>;
}
