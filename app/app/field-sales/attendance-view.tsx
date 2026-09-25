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
  const query = useQuery({ queryKey: ['field-attendance', organizationId, userId, date],
    queryFn: async () => {
      const response = await fetch(`/api/v1/field-sales/attendance?date=${encodeURIComponent(date)}`, { cache: 'no-store' });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error?.message ?? 'Attendance could not be loaded.');
      return payload.data as AttendanceDay;
    }, refetchInterval: date === initialDate ? 30000 : false, gcTime: 0 });
  const rows = query.data?.rows.filter(row => selectedEmployeeId === 'all' || row.employee_id === selectedEmployeeId) ?? [];
  const manager = query.data?.role === 'manager' || query.data?.role === 'admin';
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
      setNote('');
    } catch (error) { setProblem(error instanceof Error ? error.message : 'Leave could not be updated.'); }
    finally { setBusyId(null); }
  }
  return <section className="space-y-4" aria-label="Daily field officer attendance">
    <div><h2 className="text-lg font-semibold">Daily attendance</h2>
      <p className="text-sm text-muted-foreground">Punch records determine attendance and working time. Each organization calendar day ends at midnight in {query.data?.timezone ?? 'the organization time zone'}. Unpunched past days are Absent unless approved leave is recorded.</p></div>
    <div className="flex flex-wrap items-end gap-3">
      <label className="grid gap-1 text-sm font-medium">Date<Input type="date" value={date} onChange={event => { if (event.target.value) setDate(event.target.value); }}/></label>
      <Button variant="outline" aria-label="Previous attendance day" onClick={() => setDate(addCalendarDays(date, -1))}>Previous</Button>
      <Button variant="outline" aria-label="Next attendance day" onClick={() => setDate(addCalendarDays(date, 1))}>Next</Button>
      <Button variant="outline" onClick={() => setDate(initialDate)}>Today</Button>
      <label className="grid gap-1 text-sm font-medium">Employee<select className="h-10 rounded-md border bg-background px-3" value={selectedEmployeeId} onChange={event => onSelectEmployee(event.target.value)}>
        <option value="all">All employees</option>{query.data?.rows.map(row => <option key={row.employee_id} value={row.employee_id}>{row.display_name}</option>)}
      </select></label>
    </div>
    {query.isPending && <p role="status">Loading attendance…</p>}
    {query.error && <p role="alert">{query.error.message} <Button variant="outline" onClick={() => void query.refetch()}>Retry</Button></p>}
    {problem && <p role="alert">{problem}</p>}
    {manager && <label className="grid max-w-md gap-1 text-sm font-medium">Leave reason (optional)<Input value={note} maxLength={500} onChange={event => setNote(event.target.value)} placeholder="Approved leave note"/></label>}
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{rows.map(row => <article key={row.employee_id} className="rounded-xl border bg-card p-4">
      <div className="flex items-start justify-between gap-2"><h3 className="font-semibold">{row.display_name}</h3><span className={`rounded-full px-2 py-1 text-xs font-medium ${row.status === 'present' ? 'bg-emerald-100 text-emerald-900' : row.status === 'leave' ? 'bg-sky-100 text-sky-900' : 'bg-muted text-muted-foreground'}`}>{statusLabel[row.status]}</span></div>
      <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
        <div><dt className="text-muted-foreground">First punch-in</dt><dd>{time(row.first_in_at)}</dd></div>
        <div><dt className="text-muted-foreground">Last punch-out</dt><dd>{row.open ? 'Still on duty' : time(row.last_out_at)}</dd></div>
        <div><dt className="text-muted-foreground">Working time</dt><dd>{duration(row.working_minutes)}{row.open ? ' so far' : ''}</dd></div>
        <div><dt className="text-muted-foreground">Breaks</dt><dd>{duration(row.break_minutes)}</dd></div>
        <div className="col-span-2"><dt className="text-muted-foreground">Validated travel</dt><dd>{row.travel_distance_m === null ? 'GPS data unavailable' : `${(row.travel_distance_m / 1000).toFixed(2)} km`}</dd></div>
      </dl>
      {row.leave_note && <p className="mt-2 text-sm">Leave: {row.leave_note}</p>}
      {row.leave_conflict && <p className="mt-2 text-sm text-amber-800" role="alert">Approved leave overlaps a recorded punch. Review this day.</p>}
      {row.gps_points > 0 && <p className="mt-2 text-xs text-muted-foreground">Distance is estimated from quality-filtered, sampled GPS. It may undercount travel.</p>}
      {manager && row.status !== 'inactive' && <div className="mt-3">
        {row.status === 'leave' ? <Button variant="outline" disabled={busyId !== null} onClick={() => void leave(row, 'revoke_leave')}>Remove leave</Button>
          : row.status !== 'present' && <Button variant="outline" disabled={busyId !== null} onClick={() => void leave(row, 'approve_leave')}>Approve leave</Button>}
      </div>}
    </article>)}</div>
    {query.data && !rows.length && <p>No employees in this attendance view.</p>}
  </section>;
}
