'use client';

import { routeColor } from '@/lib/field-sales/route-colors';

type Employee = { user_id: string; display_name: string; active: boolean };
type Assignment = { employee_id: string; project_id: string; schedule: { start_date: string; end_date: string | null } };
type Session = { employee_id: string; project_id: string | null; punched_out_at: string | null };

export function ProjectStaff({ projectId, employees, assignments, sessions, date, loading, error }: {
  projectId: string; employees: Employee[]; assignments: Assignment[]; sessions: Session[];
  date: string; loading: boolean; error: boolean;
}) {
  const active = employees.filter(person => person.active);
  const working = active.filter(person => sessions.some(session => session.employee_id === person.user_id
    && session.project_id === projectId && !session.punched_out_at));
  const assigned = active.filter(person => assignments.some(assignment => assignment.employee_id === person.user_id
    && assignment.project_id === projectId && assignment.schedule.start_date <= date
    && (!assignment.schedule.end_date || assignment.schedule.end_date >= date)));
  const name = (person: Employee) => <li key={person.user_id} className="flex items-center gap-2">
    <span aria-hidden className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: routeColor(person.user_id, employees.map(item => item.user_id)) }}/>
    <span>{person.display_name}</span>
  </li>;
  return <div className="mt-3 space-y-3 border-t pt-3 text-sm">
    <div><h3 className="font-medium">Working now · {working.length}</h3>
      {loading ? <p className="text-muted-foreground">Checking attendance…</p>
        : error ? <p className="text-muted-foreground">Attendance unavailable.</p>
          : working.length ? <ul className="mt-1 space-y-1">{working.map(name)}</ul>
            : <p className="text-muted-foreground">No officer punched in to this project.</p>}</div>
    <div><h3 className="font-medium">Assigned officers · {assigned.length}</h3>
      {assigned.length ? <ul className="mt-1 space-y-1">{assigned.map(name)}</ul>
        : <p className="text-muted-foreground">No current assignments.</p>}</div>
  </div>;
}
