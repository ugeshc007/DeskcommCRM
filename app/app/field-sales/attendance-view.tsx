'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { addCalendarDays } from '@/lib/field-sales/schedule';

type AttendanceRow = { employee_id: string; display_name: string; status: 'present' | 'leave' | 'absent' | 'pending' | 'inactive'; leave_conflict: boolean;
  leave_note: string | null; first_in_at: string | null; last_out_at: string | null; open: boolean;
  working_minutes: number; break_minutes: number; travel_distance_m: number | null; gps_points: number; reliable_route_points: number };
type AttendanceDay = { date: string; timezone: string; role: string; rows: AttendanceRow[] };
type AttendanceMonth = { month: string; timezone: string; employee: { id: string; name: string };
  rows: (AttendanceRow & { date: string; project_names: string[] })[] };
const statusLabel: Record<AttendanceRow['status'], string> = {
  present: 'Present', leave: 'Leave', absent: 'Absent', pending: 'Awaiting day end', inactive: 'Inactive',
};
function duration(minutes: number) { return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`; }

export function AttendanceView({ organizationId, userId, initialDate, selectedEmployeeId, onSelectEmployee }: {
  organizationId: string; userId: string; initialDate: string; selectedEmployeeId: string;
  onSelectEmployee: (id: string) => void;
}) {
  const cache = useQueryClient();
  const [date, setDate] = useState(initialDate);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [problem, setProblem] = useState('');
  const [note, setNote] = useState('');
  const [month, setMonth] = useState(initialDate.slice(0, 7));
  const [monthEmployeeId, setMonthEmployeeId] = useState(selectedEmployeeId === 'all' ? '' : selectedEmployeeId);
  const [exporting, setExporting] = useState(false);
  const [monthProblem, setMonthProblem] = useState('');
  const query = useQuery({ queryKey: ['field-attendance', organizationId, userId, date],
    queryFn: async () => {
      const response = await fetch(`/api/v1/field-sales/attendance?date=${encodeURIComponent(date)}`, { cache: 'no-store' });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error?.message ?? 'Attendance could not be loaded.');
      return payload.data as AttendanceDay;
    }, refetchInterval: date === initialDate ? 30000 : false, gcTime: 0 });
  const rows = query.data?.rows.filter(row => selectedEmployeeId === 'all' || row.employee_id === selectedEmployeeId) ?? [];
  const manager = query.data?.role === 'manager' || query.data?.role === 'admin';
  const effectiveMonthEmployeeId = monthEmployeeId || (query.data?.rows.length === 1 ? query.data.rows[0]!.employee_id : '');
  const monthQuery = useQuery({ queryKey: ['field-attendance-month', organizationId, userId, month, effectiveMonthEmployeeId],
    enabled: Boolean(effectiveMonthEmployeeId), gcTime: 0, refetchInterval: month === initialDate.slice(0, 7) ? 30000 : false,
    queryFn: async () => {
      const params = new URLSearchParams({ month, employee_id: effectiveMonthEmployeeId });
      const response = await fetch(`/api/v1/field-sales/attendance/month?${params}`, { cache: 'no-store' });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error?.message ?? 'Monthly attendance could not be loaded.');
      return payload.data as AttendanceMonth;
    } });
  const time = (instant: string | null) => instant && query.data
    ? new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short', timeZone: query.data.timezone }).format(new Date(instant)) : '—';
  async function leave(row: AttendanceRow, operation: 'approve_leave' | 'revoke_leave') {
    setBusyId(row.employee_id); setProblem('');
    try {
      const response = await fetch('/api/v1/field-sales/attendance', { method: 'POST',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ operation, employee_id: row.employee_id, date, note }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error?.message ?? 'Leave could not be updated.');
      await cache.invalidateQueries({ queryKey: ['field-attendance', organizationId, userId] });
      await cache.invalidateQueries({ queryKey: ['field-attendance-month', organizationId, userId] });
      setNote('');
    } catch (error) { setProblem(error instanceof Error ? error.message : 'Leave could not be updated.'); }
    finally { setBusyId(null); }
  }
  async function exportMonth() {
    if (!effectiveMonthEmployeeId) return;
    setExporting(true); setMonthProblem('');
    try {
      const params = new URLSearchParams({ month, employee_id: effectiveMonthEmployeeId, format: 'xlsx' });
      const response = await fetch(`/api/v1/field-sales/attendance/month?${params}`, { cache: 'no-store' });
      if (!response.ok) {
        const payload = await response.json();
        throw new Error(payload.error?.message ?? 'Excel export could not be downloaded.');
      }
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement('a'); link.href = url; link.download = `field-attendance-${month}.xlsx`;
      document.body.appendChild(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) { setMonthProblem(error instanceof Error ? error.message : 'Excel export could not be downloaded.'); }
    finally { setExporting(false); }
  }
  return <section className="space-y-4" aria-label="Daily field officer attendance">
    <div><h2 className="text-lg font-semibold">Daily attendance</h2>
      <p className="text-sm text-muted-foreground">Punch records determine attendance and working time. Overnight shifts count in full on their check-in date in {query.data?.timezone ?? 'the organization time zone'}; check-out still shows its actual date. Unpunched past days are Absent unless approved leave is recorded.</p></div>
    <div className="flex flex-wrap items-end gap-3">
      <label className="grid gap-1 text-sm font-medium">Date<Input type="date" value={date} onChange={event => { if (event.target.value) setDate(event.target.value); }}/></label>
      <Button variant="outline" aria-label="Previous attendance day" onClick={() => setDate(addCalendarDays(date, -1))}>Previous</Button>
      <Button variant="outline" aria-label="Next attendance day" onClick={() => setDate(addCalendarDays(date, 1))}>Next</Button>
      <Button variant="outline" onClick={() => setDate(initialDate)}>Today</Button>
      <label className="grid gap-1 text-sm font-medium">Employee<select className="h-10 rounded-md border bg-background px-3" value={selectedEmployeeId} onChange={event => { onSelectEmployee(event.target.value); setMonthEmployeeId(event.target.value === 'all' ? '' : event.target.value); }}>
        <option value="all">All employees</option>{query.data?.rows.map(row => <option key={row.employee_id} value={row.employee_id}>{row.display_name}</option>)}
      </select></label>
    </div>
    {query.isPending && <p role="status">Loading attendance…</p>}
    {query.error && <p role="alert">{query.error.message} <Button variant="outline" onClick={() => void query.refetch()}>Retry</Button></p>}
    {problem && <p role="alert">{problem}</p>}
    {manager && <label className="grid max-w-md gap-1 text-sm font-medium">Leave reason (optional)<Input value={note} maxLength={500} onChange={event => setNote(event.target.value)} placeholder="Approved leave note"/></label>}
    <div data-layout="list" className="divide-y rounded-lg border bg-card">{rows.map(row => <article key={row.employee_id} className="grid gap-2 p-2 lg:grid-cols-[minmax(12rem,1fr)_minmax(0,2fr)_auto] lg:items-center lg:gap-3">
      <div className="flex items-start justify-between gap-2"><h3 className="font-semibold">{row.display_name}</h3><span className={`rounded-full px-2 py-1 text-xs font-medium ${row.status === 'present' ? 'bg-emerald-100 text-emerald-900' : row.status === 'leave' ? 'bg-sky-100 text-sky-900' : 'bg-muted text-muted-foreground'}`}>{statusLabel[row.status]}</span></div>
      <div><dl className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-3 lg:grid-cols-5">
        <div><dt className="text-muted-foreground">First punch-in</dt><dd>{time(row.first_in_at)}</dd></div>
        <div><dt className="text-muted-foreground">Last punch-out</dt><dd>{row.open ? 'Still on duty' : time(row.last_out_at)}</dd></div>
        <div><dt className="text-muted-foreground">Working time</dt><dd>{duration(row.working_minutes)}{row.open ? ' so far' : ''}</dd></div>
        <div><dt className="text-muted-foreground">Breaks</dt><dd>{duration(row.break_minutes)}</dd></div>
        <div><dt className="text-muted-foreground">Validated travel</dt><dd>{row.travel_distance_m === null ? 'GPS data unavailable' : `${(row.travel_distance_m / 1000).toFixed(2)} km`}</dd></div>
      </dl>
      {row.leave_note && <p className="mt-2 text-sm">Leave: {row.leave_note}</p>}
      {row.leave_conflict && <p className="mt-2 text-sm text-amber-800" role="alert">Approved leave overlaps a recorded punch. Review this day.</p>}
      {row.gps_points > 0 && <p className="mt-2 text-xs text-muted-foreground">Distance is estimated from quality-filtered, sampled GPS. It may undercount travel.</p>}
      </div>
      {manager && row.status !== 'inactive' && <div>
        {row.status === 'leave' ? <Button variant="outline" disabled={busyId !== null} onClick={() => void leave(row, 'revoke_leave')}>Remove leave</Button>
          : row.status !== 'present' && <Button variant="outline" disabled={busyId !== null} onClick={() => void leave(row, 'approve_leave')}>Approve leave</Button>}
      </div>}
    </article>)}</div>
    {query.data && !rows.length && <p>No employees in this attendance view.</p>}
    <section className="space-y-3 border-t pt-5" aria-label="Monthly field officer attendance">
      <div><h2 className="text-lg font-semibold">Monthly attendance</h2>
        <p className="text-sm text-muted-foreground">One row for every check-in date, including days without a punch. Overnight hours stay with the check-in date; check-out shows its full local date and time in {query.data?.timezone ?? 'the organization time zone'}.</p></div>
      <div className="flex flex-wrap items-end gap-3">
        <label className="grid gap-1 text-sm font-medium">Month<Input type="month" value={month} onChange={event => { if (event.target.value) setMonth(event.target.value); }}/></label>
        <label className="grid gap-1 text-sm font-medium">Employee<select className="h-10 rounded-md border bg-background px-3" value={effectiveMonthEmployeeId} onChange={event => setMonthEmployeeId(event.target.value)}>
          {manager && <option value="">Select an employee</option>}
          {query.data?.rows.map(row => <option key={row.employee_id} value={row.employee_id}>{row.display_name}</option>)}
        </select></label>
        <Button variant="outline" disabled={!effectiveMonthEmployeeId || exporting} onClick={() => void exportMonth()}>
          {exporting ? 'Preparing Excel…' : 'Export employee Excel'}
        </Button>
      </div>
      {monthProblem && <p role="alert">{monthProblem}</p>}
      {!effectiveMonthEmployeeId && <p className="text-sm text-muted-foreground">Select an employee to see the month and download the Excel file.</p>}
      {monthQuery.isPending && effectiveMonthEmployeeId && <p role="status">Loading monthly attendance…</p>}
      {monthQuery.error && <p role="alert">{monthQuery.error.message} <Button variant="outline" onClick={() => void monthQuery.refetch()}>Retry</Button></p>}
      {monthQuery.data && <div className="overflow-x-auto rounded-lg border"><table className="w-full min-w-[50rem] text-left text-sm">
        <thead className="bg-muted/50"><tr><th className="p-2">Date</th><th className="p-2">Project</th><th className="p-2">Status</th><th className="p-2">First check-in</th><th className="p-2">Last check-out</th><th className="p-2">Working time</th><th className="p-2">Breaks</th></tr></thead>
        <tbody className="divide-y">{monthQuery.data.rows.map(day => <tr key={day.date}>
          <td className="p-2">{day.date}</td><td className="p-2">{day.project_names.join(', ') || '—'}</td><td className="p-2">{statusLabel[day.status]}</td>
          <td className="p-2">{day.first_in_at ? new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short', timeZone: monthQuery.data.timezone }).format(new Date(day.first_in_at)) : '—'}</td>
          <td className="p-2">{day.open ? 'Still on duty' : day.last_out_at ? new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short', timeZone: monthQuery.data.timezone }).format(new Date(day.last_out_at)) : '—'}</td>
          <td className="p-2">{duration(day.working_minutes)}</td><td className="p-2">{duration(day.break_minutes)}</td>
        </tr>)}</tbody>
      </table></div>}
    </section>
  </section>;
}
