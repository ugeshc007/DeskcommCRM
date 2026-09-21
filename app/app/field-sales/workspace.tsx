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
import { addCalendarDays } from '@/lib/field-sales/schedule';
import { FieldOperations } from './operations';
import type { FieldSchedule } from '@/lib/field-sales/contracts';
import { useT } from '@/hooks/i18n/useT';

type Employee = { user_id: string; display_name: string; active: boolean };
type Project = { id: string; name: string; site_name: string; active: boolean };
type Occurrence = { occurrence_key: string; employee_id: string; date: string; starts_at: string; ends_at: string;
  employee_name: string; project_name: string; site_name: string; revision: number; schedule: FieldSchedule; timezone: string };
type CalendarData = { installed: boolean; role?: 'field_officer' | 'agent' | 'manager' | 'admin';
  region?: { country_code: string; timezone: string } | null;
  settings?: { revision: number; enabled: boolean; retention_days: number; notice_text: string } | null;
  employees?: Employee[]; projects?: Project[]; occurrences?: Occurrence[];
  manager_scopes?: Array<{ manager_id: string; employee_id: string }>;
  overlaps?: Array<[string, string]>; warnings?: Array<{ schedule_id: string; reason: string }> };
type Member = { user_id: string; full_name: string | null; role: string };
const selectClass = 'h-11 w-full min-w-0 rounded-md border border-input bg-background px-3 text-sm';

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
  const [start, setStart] = useState(() => new Date().toISOString().slice(0, 10));
  const calendarInitialized = useRef(false);
  const [view, setView] = useState<'day' | 'week'>('week');
  const [dialog, setDialog] = useState<'project' | 'schedule' | 'employee' | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState('');
  const [employeeFilter, setEmployeeFilter] = useState('all');
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
  useEffect(() => {
    if (!timezone || calendarInitialized.current) return;
    calendarInitialized.current = true;
    const parts = new Intl.DateTimeFormat('en', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
    const part = (type: string) => parts.find(item => item.type === type)?.value ?? '';
    setStart(`${part('year')}-${part('month')}-${part('day')}`);
  }, [timezone]);
  const days = Array.from({ length: view === 'week' ? 7 : 1 }, (_, i) => addCalendarDays(start, i));
  const people = data?.employees ?? [], projects = data?.projects ?? [];
  const clashes = new Set((data?.overlaps ?? []).flat());

  async function save(input: unknown) {
    if (busy) return;
    setBusy(true); setError(''); setMessage('');
    try {
      const response = await fetch('/api/v1/field-sales', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message ?? 'Changes could not be saved.');
      await cache.invalidateQueries({ queryKey: ['field-sales'] });
      setDialog(null); setMessage('Saved. The calendar has been refreshed.');
    } catch (e) { setError(e instanceof Error ? e.message : 'Changes could not be saved.'); }
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
      <Tabs defaultValue="calendar">
        <TabsList className="flex h-auto flex-wrap justify-start"><TabsTrigger value="calendar">Calendar</TabsTrigger><TabsTrigger value="activity">Live view</TabsTrigger><TabsTrigger value="projects">Projects</TabsTrigger><TabsTrigger value="team">Team</TabsTrigger>{administrator && <TabsTrigger value="policy">Tracking policy</TabsTrigger>}</TabsList>
        <TabsContent value="activity"><FieldOperations organizationId={organizationId} userId={userId} date={start}/></TabsContent>
        <TabsContent value="calendar" className="space-y-4">
          <div className="flex flex-wrap items-end gap-3">
            <Button variant="outline" aria-label="Previous period" onClick={() => setStart(addCalendarDays(start, view === 'week' ? -7 : -1))}><CaretLeft aria-hidden/></Button>
            <Field label="Starting date"><Input type="date" value={start} onChange={e => { if (e.target.value) setStart(e.target.value); }}/></Field>
            <Button variant="outline" aria-label="Next period" onClick={() => setStart(addCalendarDays(start, view === 'week' ? 7 : 1))}><ArrowRight aria-hidden/></Button>
            <Field label="Calendar view"><select className={selectClass} value={view} onChange={e => setView(e.target.value as 'day' | 'week')}><option value="day">Day</option><option value="week">Week</option></select></Field>
            <Field label="Salesperson"><select className={selectClass} value={employeeFilter} onChange={e => setEmployeeFilter(e.target.value)}><option value="all">All authorized staff</option>{people.map(e => <option key={e.user_id} value={e.user_id}>{e.display_name}</option>)}</select></Field>
          </div>
          {!!data.overlaps?.length && <p role="alert" className="rounded-lg border p-3">{data.overlaps.length} overlapping assignment pair(s). Review the highlighted visits before notifying staff.</p>}
          {data.warnings?.map(w => <p role="alert" key={w.schedule_id}>{w.reason}</p>)}
          <div className={`grid gap-3 ${view === 'week' ? 'md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4' : ''}`}>
            {days.map(date => <section key={date} className="min-w-0 rounded-xl border bg-card p-3">
              <h2 className="mb-3 text-sm font-semibold">{new Intl.DateTimeFormat('en', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(date + 'T00:00:00Z'))}</h2>
              <div className="space-y-3">{(data.occurrences ?? []).filter(o => o.date === date && (employeeFilter === 'all' || o.employee_id === employeeFilter)).map(o => <article key={o.occurrence_key} className={`break-words rounded-lg border-l-4 p-3 ${clashes.has(o.occurrence_key) ? 'border-destructive bg-muted' : 'border-primary bg-muted/40'}`}>
                <p className="font-medium">{o.project_name}</p><p className="mt-1 text-sm">{o.employee_name}</p><p className="text-sm text-muted-foreground">{o.site_name}</p>
                <p className="mt-2 text-xs">{timezone ? new Intl.DateTimeFormat('en', { hour: '2-digit', minute: '2-digit', timeZone: timezone }).format(new Date(o.starts_at)) : o.starts_at} – {timezone ? new Intl.DateTimeFormat('en', { hour: '2-digit', minute: '2-digit', timeZone: timezone }).format(new Date(o.ends_at)) : o.ends_at}</p>
                {manager && <Button variant="ghost" size="sm" disabled={busy || Date.parse(o.starts_at) <= Date.now()} onClick={() => { if (window.confirm('Cancel only this occurrence? The recurring series and history will be preserved.')) void save({ operation: 'cancel_occurrence', id: o.occurrence_key.split(':')[0], revision: o.revision, date: o.date }); }}>Cancel this visit</Button>}
                {manager && <Button variant="outline" size="sm" disabled={busy || Date.parse(o.starts_at) <= Date.now()} onClick={() => { setError(''); setEditing(o); setEditScope('one'); setDraftId(crypto.randomUUID()); setDialog('schedule'); }}>Edit visit</Button>}
              </article>)}
                {!(data.occurrences ?? []).some(o => o.date === date && (employeeFilter === 'all' || o.employee_id === employeeFilter)) && <p className="py-6 text-sm text-muted-foreground">No assigned visits</p>}
              </div></section>)}
          </div>
        </TabsContent>
        <TabsContent value="projects" className="space-y-4">{administrator && <Button variant="outline" onClick={() => setDialog('project')}><Plus aria-hidden/>New project</Button>}
          {!projects.length && <p className="rounded-xl border p-6">No projects yet. Add a project and its site, then assign a calendar visit.</p>}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{projects.map(p => <article key={p.id} className="rounded-xl border p-5"><h2 className="font-semibold">{p.name}</h2><p>{p.site_name}</p><p className="text-sm text-muted-foreground">{p.active ? 'Active' : 'Archived'}</p></article>)}</div>
        </TabsContent>
        <TabsContent value="team" className="space-y-4">{administrator && <Button variant="outline" onClick={() => setDialog('employee')}><Plus aria-hidden/>Enroll salesperson</Button>}
          {administrator && <form className="max-w-xl space-y-3 rounded-xl border p-4" onSubmit={event => { event.preventDefault(); const form = new FormData(event.currentTarget); void save({ operation: 'manager_scope', manager_id: String(form.get('manager')), employee_id: String(form.get('employee')), granted: form.has('granted') }); }}>
            <h2 className="font-semibold">Manager visibility</h2><p className="text-sm text-muted-foreground">Managers see only explicitly assigned staff. Organization administrators can see the whole field team.</p>
            <Field label="Manager"><select name="manager" required className={selectClass}><option value="">Choose manager</option>{(members.data ?? []).filter(member => member.role === 'manager').map(member => <option key={member.user_id} value={member.user_id}>{member.full_name ?? 'Unnamed manager'}</option>)}</select></Field>
            <Field label="Salesperson"><select name="employee" required className={selectClass}><option value="">Choose salesperson</option>{people.filter(person => person.active).map(person => <option key={person.user_id} value={person.user_id}>{person.display_name}</option>)}</select></Field>
            <label className="flex items-center gap-2"><input type="checkbox" name="granted" defaultChecked/>Grant access (uncheck to revoke)</label><Button disabled={busy}>Save manager scope</Button>
          </form>}
          {administrator && <section className="space-y-2" aria-label="Existing manager access">
            <h2 className="font-semibold">Current manager access</h2>
            {!data.manager_scopes?.length && <p className="text-sm text-muted-foreground">No manager has been assigned access yet.</p>}
            {data.manager_scopes?.map(grant => <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3" key={`${grant.manager_id}:${grant.employee_id}`}>
              <span>{members.data?.find(member => member.user_id === grant.manager_id)?.full_name ?? 'Former or unnamed manager'} → {people.find(person => person.user_id === grant.employee_id)?.display_name ?? 'Former salesperson'}</span>
              <Button variant="outline" disabled={busy} onClick={() => void save({ operation: 'manager_scope', ...grant, granted: false })}>Revoke access</Button>
            </div>)}
          </section>}
          <p className="text-sm text-muted-foreground">Enrollment does not start tracking. Staff must punch in from their authorized Android app.</p>
          {people.map(e => <div className="flex flex-wrap justify-between gap-2 rounded-lg border p-4" key={e.user_id}><span>{e.display_name}</span><span>{e.active ? 'Enrolled' : 'Inactive'}</span></div>)}
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
    <Dialog open={dialog !== null} onOpenChange={open => { if (!open) setDialog(null); }}><DialogContent className="max-h-[85vh] overflow-y-auto"><DialogHeader><DialogTitle>{dialog === 'project' ? 'New project' : dialog === 'employee' ? 'Enroll salesperson' : 'Assign project'}</DialogTitle></DialogHeader>
      {error && <p role="alert">{error}</p>}
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
